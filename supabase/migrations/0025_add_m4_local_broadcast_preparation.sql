-- M4 disposable pilot: durable YouTube preparation, no encoder start authority.
alter table public.broadcast_sessions add column transport text not null default 'livekit'
  check (transport in ('livekit','local-obs'));
alter table public.broadcast_sessions drop constraint broadcast_sessions_status_check;
alter table public.broadcast_sessions add constraint broadcast_sessions_status_check
  check (status in ('idle','preparing','prepared','live','stopping','stopped','failed'));

-- Preserve original implementations behind service-inaccessible wrappers.
alter function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) rename to legacy_claim_game_broadcast_operation;
alter function public.get_game_broadcast_session(uuid,uuid,boolean) rename to legacy_get_game_broadcast_session;
alter function public.record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text) rename to legacy_record_game_broadcast_operation;
revoke all on function public.legacy_claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.legacy_get_game_broadcast_session(uuid,uuid,boolean) from public,anon,authenticated,service_role;
revoke all on function public.legacy_record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text) from public,anon,authenticated,service_role;

create function public.lock_broadcast_transport(p_game_id uuid,p_transport text) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  perform 1 from public.games where id=p_game_id for update;
  perform 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
  if exists(select 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' and transport<>p_transport) then
    raise exception 'broadcast transport mismatch' using errcode='55000';
  end if;
end $$;
revoke all on function public.lock_broadcast_transport(uuid,text) from public,anon,authenticated,service_role;

create function public.claim_game_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_broadcast_transport(p_game_id,'livekit');
  return public.legacy_claim_game_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,p_desired_state,p_operation_token);
end $$;
create function public.get_game_broadcast_session(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_broadcast_transport(p_game_id,'livekit');
  return public.legacy_get_game_broadcast_session(p_game_id,p_actor_user_id,p_verified_organizer);
end $$;
create function public.record_game_broadcast_operation(p_game_id uuid,p_generation bigint,p_operation_token uuid,p_status text,p_youtube_broadcast_id text default null,p_youtube_stream_id text default null,p_livekit_egress_id text default null,p_watch_url text default null,p_error_code text default null,p_provider_step text default null,p_uncertain boolean default false,p_youtube_broadcast_create_state text default null,p_youtube_stream_create_state text default null,p_livekit_egress_create_state text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_broadcast_transport(p_game_id,'livekit');
  return public.legacy_record_game_broadcast_operation(p_game_id,p_generation,p_operation_token,p_status,p_youtube_broadcast_id,p_youtube_stream_id,p_livekit_egress_id,p_watch_url,p_error_code,p_provider_step,p_uncertain,p_youtube_broadcast_create_state,p_youtube_stream_create_state,p_livekit_egress_create_state);
end $$;

create function public.get_m4_broadcast_session(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  return public.legacy_get_game_broadcast_session(p_game_id,p_actor_user_id,p_verified_organizer)||jsonb_build_object('transport','local-obs');
end $$;
create function public.claim_m4_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_result jsonb; v_session public.broadcast_sessions; v_game public.games;
begin
  if p_desired_state is null or p_desired_state not in ('prepared','stopped') or p_operation_token is null then raise exception 'invalid M4 intent' using errcode='22023'; end if;
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,p_verified_organizer);
  select * into v_game from public.games where id=p_game_id;
  if p_desired_state='prepared' then
    if v_game.config->>'youtubeVisibility' is distinct from 'unlisted' then raise exception 'M4 requires unlisted visibility' using errcode='55000'; end if;
    if v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
      or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active' then raise exception 'terminal game' using errcode='55000'; end if;
  end if;
  select * into v_session from public.broadcast_sessions where game_id=p_game_id and provider='youtube';
  if found and p_desired_state='prepared' and v_session.status='prepared' and v_session.desired_state='live' then
    -- Revalidate saved channel credentials even when preparation is already done.
    if not exists(select 1 from public.broadcast_settings where organization_id=v_game.organization_id and provider='youtube' and connection_status='connected' and channel_id=v_session.youtube_channel_id and encrypted_credentials is not null) then raise exception 'youtube reconnect required' using errcode='55000'; end if;
    return public.legacy_get_game_broadcast_session(p_game_id,p_actor_user_id,p_verified_organizer)||jsonb_build_object('action','none','transport','local-obs');
  end if;
  v_result:=public.legacy_claim_game_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,case when p_desired_state='prepared' then 'live' else 'stopped' end,p_operation_token);
  update public.broadcast_sessions set transport='local-obs' where game_id=p_game_id and provider='youtube';
  return v_result||jsonb_build_object('transport','local-obs');
end $$;
create function public.record_m4_broadcast_operation(p_game_id uuid,p_generation bigint,p_operation_token uuid,p_status text,p_youtube_broadcast_id text default null,p_youtube_stream_id text default null,p_watch_url text default null,p_error_code text default null,p_provider_step text default null,p_uncertain boolean default false,p_youtube_broadcast_create_state text default null,p_youtube_stream_create_state text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_session public.broadcast_sessions; v_result jsonb;
begin
  if p_status is null or p_status not in ('preparing','prepared','stopping','stopped','failed') then raise exception 'invalid M4 state' using errcode='22023'; end if;
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  select * into v_session from public.broadcast_sessions where game_id=p_game_id and provider='youtube';
  if not found or v_session.operation_generation is distinct from p_generation or v_session.operation_token is distinct from p_operation_token or p_operation_token is null or v_session.lease_expires_at is null or v_session.lease_expires_at<=now() then return null; end if;
  if p_status in ('preparing','prepared') and exists(select 1 from public.games g join public.game_states gs on gs.game_id=g.id where g.id=p_game_id and (g.deleted_at is not null or g.completed_at is not null or g.status<>'active' or gs.state->>'status' is distinct from 'active')) then return null; end if;
  if p_status='prepared' and (coalesce(p_youtube_broadcast_id,v_session.youtube_broadcast_id) is null or coalesce(p_youtube_stream_id,v_session.youtube_stream_id) is null or coalesce(p_youtube_broadcast_create_state,v_session.youtube_broadcast_create_state)<>'ready' or coalesce(p_youtube_stream_create_state,v_session.youtube_stream_create_state)<>'ready' or p_uncertain) then raise exception 'M4 preparation incomplete' using errcode='22023'; end if;
  v_result:=public.legacy_record_game_broadcast_operation(p_game_id,p_generation,p_operation_token,case when p_status='prepared' then 'preparing' else p_status end,p_youtube_broadcast_id,p_youtube_stream_id,null,p_watch_url,p_error_code,p_provider_step,p_uncertain,p_youtube_broadcast_create_state,p_youtube_stream_create_state,null);
  if v_result is null then return null; end if;
  if p_status='prepared' then
    update public.broadcast_sessions set status='prepared',lease_expires_at=null,operation_token=null where game_id=p_game_id and provider='youtube' returning * into v_session;
    v_result:=public.broadcast_session_json(v_session);
  end if;
  return v_result||jsonb_build_object('transport','local-obs');
end $$;

revoke all on function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid),public.get_game_broadcast_session(uuid,uuid,boolean),public.record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text),public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid),public.get_m4_broadcast_session(uuid,uuid,boolean),public.record_m4_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,boolean,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid),public.get_game_broadcast_session(uuid,uuid,boolean),public.record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text),public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid),public.get_m4_broadcast_session(uuid,uuid,boolean),public.record_m4_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,boolean,text,text) to service_role;
notify pgrst,'reload schema';

-- Authorization-only transport discovery supports completion/deletion dispatch.
create function public.get_game_broadcast_transport(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean) returns text
language plpgsql security definer set search_path='' stable as $$
begin
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,p_verified_organizer);
  return (select transport from public.broadcast_sessions where game_id=p_game_id and provider='youtube');
end $$;
revoke all on function public.get_game_broadcast_transport(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.get_game_broadcast_transport(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
