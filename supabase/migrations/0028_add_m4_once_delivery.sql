-- Once-only target handoff. A lost RPC response is deliberately unrecoverable.
alter table public.m4_output_intents add column delivery_channel_id text;
alter table public.m4_output_intents add column delivery_connection_version bigint;

create function public.m4_output_delivery_authority(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid,p_consume boolean)
returns table(intent_id uuid,session_id uuid,generation bigint,organization_id uuid,broadcast_generation bigint,youtube_broadcast_id text,youtube_stream_id text,youtube_channel_id text,youtube_connection_version bigint,encrypted_credentials text,expires_at timestamptz,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_b public.broadcast_sessions; v_i public.m4_output_intents; v_s public.m4_desktop_sessions; v_c public.broadcast_settings;
begin
  v_b:=public.validate_m4_output_authority(p_game_id,p_session_id,p_generation,p_bearer_hash);
  select * into v_s from public.m4_desktop_sessions s where s.session_id=p_session_id;
  -- now() is transaction-start time; blocked requests must use actual lock-acquisition time.
  if v_s.expires_at<=clock_timestamp() or v_s.lease_expires_at<=clock_timestamp() then raise exception 'desktop authority expired' using errcode='42501'; end if;
  select * into v_i from public.m4_output_intents i where i.intent_id=p_intent_id for update;
  if not found or v_i.game_id<>p_game_id or v_i.organization_id<>v_b.organization_id or v_i.session_id<>p_session_id or v_i.generation<>p_generation
    or v_i.broadcast_generation<>v_b.operation_generation or v_i.youtube_broadcast_id<>v_b.youtube_broadcast_id or v_i.youtube_stream_id<>v_b.youtube_stream_id
    or v_i.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  select * into v_c from public.broadcast_settings c where c.organization_id=v_b.organization_id and c.provider='youtube' for update;
  if not found or v_c.connection_status<>'connected' or v_c.encrypted_credentials is null or v_c.channel_id is distinct from v_b.youtube_channel_id
    or v_c.channel_id is null or v_c.connection_version is null then raise exception 'youtube reconnect required' using errcode='55000'; end if;
  if v_s.expires_at<=clock_timestamp() or v_s.lease_expires_at<=clock_timestamp() then raise exception 'desktop authority expired' using errcode='42501'; end if;
  -- Reauthorize after all potentially blocking resource locks. A membership
  -- revocation committed while waiting must fence both consumption and assertion.
  if v_s.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_s.approved_by,false); end if;
  if p_consume then
    if v_i.phase<>'reserved' or exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null)
      then raise exception 'output delivery already consumed' using errcode='55000'; end if;
    update public.m4_output_intents i set phase='quarantined',delivery_recorded_at=clock_timestamp(),delivery_channel_id=v_c.channel_id,delivery_connection_version=v_c.connection_version
      where i.intent_id=p_intent_id returning * into v_i;
  else
    if v_i.phase<>'quarantined' or v_i.delivery_recorded_at is null or v_i.delivery_channel_id is distinct from v_c.channel_id
      or v_i.delivery_connection_version is distinct from v_c.connection_version then raise exception 'output delivery unavailable' using errcode='55000'; end if;
  end if;
  return query select v_i.intent_id,v_i.session_id,v_i.generation,v_i.organization_id,v_i.broadcast_generation,v_i.youtube_broadcast_id,v_i.youtube_stream_id,v_i.delivery_channel_id,v_i.delivery_connection_version,encode(v_c.encrypted_credentials,'base64'),v_s.expires_at,v_s.lease_expires_at;
end $$;

create function public.consume_m4_output_delivery(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,organization_id uuid,broadcast_generation bigint,youtube_broadcast_id text,youtube_stream_id text,youtube_channel_id text,youtube_connection_version bigint,encrypted_credentials text,expires_at timestamptz,lease_expires_at timestamptz)
language sql security definer set search_path='' as $$ select * from public.m4_output_delivery_authority(p_game_id,p_session_id,p_generation,p_bearer_hash,p_intent_id,true) $$;
create function public.assert_m4_output_delivery(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,organization_id uuid,broadcast_generation bigint,youtube_broadcast_id text,youtube_stream_id text,youtube_channel_id text,youtube_connection_version bigint,encrypted_credentials text,expires_at timestamptz,lease_expires_at timestamptz)
language sql security definer set search_path='' as $$ select * from public.m4_output_delivery_authority(p_game_id,p_session_id,p_generation,p_bearer_hash,p_intent_id,false) $$;
-- The read-only assertion never grants delivery permission: only the original
-- caller holding a successful consume receipt may use it before its one response.
revoke all on function public.m4_output_delivery_authority(uuid,uuid,bigint,text,uuid,boolean),public.consume_m4_output_delivery(uuid,uuid,bigint,text,uuid),public.assert_m4_output_delivery(uuid,uuid,bigint,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.consume_m4_output_delivery(uuid,uuid,bigint,text,uuid),public.assert_m4_output_delivery(uuid,uuid,bigint,text,uuid) to service_role;
notify pgrst,'reload schema';
