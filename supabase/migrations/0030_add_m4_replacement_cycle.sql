-- Replacement authority derives from provider retirement, never client Stop.
create table public.m4_broadcast_cycle_history (
  cycle_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  organization_id uuid not null references public.organizations(id),
  session_key uuid not null unique,
  retirement_id uuid references public.m4_provider_retirements(retirement_id),
  prior_operation_token uuid,
  metadata jsonb not null,
  archived_at timestamptz not null default clock_timestamp()
);
alter table public.m4_broadcast_cycle_history enable row level security;
revoke all on public.m4_broadcast_cycle_history from public,anon,authenticated,service_role;

create function public.m4_intent_is_retired(p_intent public.m4_output_intents) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.m4_provider_retirements r
    where r.retirement_id=p_intent.provider_retirement_id
      and r.game_id=p_intent.game_id and r.organization_id=p_intent.organization_id
      and r.youtube_broadcast_id is not distinct from p_intent.youtube_broadcast_id
      and r.youtube_stream_id is not distinct from p_intent.youtube_stream_id
      and r.broadcast_generation>=p_intent.broadcast_generation
      and (p_intent.delivery_channel_id is null or r.youtube_channel_id=p_intent.delivery_channel_id)
      and r.confirmed_at>=p_intent.delivery_recorded_at)
$$;
revoke all on function public.m4_intent_is_retired(public.m4_output_intents) from public,anon,authenticated,service_role;

create function public.begin_m4_replacement_cycle(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_b public.broadcast_sessions; v_g public.games; v_c public.broadcast_settings; v_r public.m4_provider_retirements; v_empty boolean;
begin
  if p_operation_token is null then raise exception 'invalid cycle intent' using errcode='22023'; end if;
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  select * into v_g from public.games where id=p_game_id;
  select * into v_b from public.broadcast_sessions where game_id=p_game_id and provider='youtube';
  perform 1 from public.m4_desktop_sessions where game_id=p_game_id order by session_id for update;
  perform 1 from public.m4_output_intents where game_id=p_game_id order by intent_id for update;
  select * into v_c from public.broadcast_settings where organization_id=v_g.organization_id and provider='youtube' for update;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if v_g.id is null or v_g.deleted_at is not null or v_g.completed_at is not null or v_g.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active'
    or v_g.config->>'youtubeVisibility' is distinct from 'unlisted' then raise exception 'replacement game unavailable' using errcode='55000'; end if;
  if v_c.organization_id is null or v_c.connection_status<>'connected' or v_c.encrypted_credentials is null or v_c.channel_id is null
    then raise exception 'youtube reconnect required' using errcode='55000'; end if;
  if v_b.id is null or v_b.organization_id<>v_g.organization_id or v_b.transport<>'local-obs' or v_b.status<>'stopped'
    or v_b.desired_state<>'stopped' or v_b.lease_expires_at is not null
    then raise exception 'replacement cycle fenced' using errcode='55000'; end if;
  if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i))
    then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  v_empty:=v_b.youtube_broadcast_id is null and v_b.youtube_stream_id is null
    and v_b.youtube_broadcast_create_state='none' and v_b.youtube_stream_create_state='none'
    and v_b.livekit_egress_create_state='none' and v_b.livekit_egress_id is null and v_b.uncertain_since is null;
  if not v_empty then
    select * into v_r from public.m4_provider_retirements where game_id=p_game_id and organization_id=v_b.organization_id
      and broadcast_generation=v_b.operation_generation
      and youtube_broadcast_id is not distinct from v_b.youtube_broadcast_id
      and youtube_stream_id is not distinct from v_b.youtube_stream_id
      and youtube_channel_id is not distinct from v_b.youtube_channel_id;
    if v_r.retirement_id is null or v_b.provider_step is distinct from 'm4-provider-retired' or v_b.uncertain_since is not null
      then raise exception 'provider retirement required' using errcode='55000'; end if;
  end if;
  insert into public.m4_broadcast_cycle_history(game_id,organization_id,session_key,retirement_id,prior_operation_token,metadata)
    values(p_game_id,v_b.organization_id,v_b.session_key,v_r.retirement_id,coalesce(v_r.operation_token,v_b.operation_token),to_jsonb(v_b));
  update public.m4_desktop_sessions set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp()) where game_id=p_game_id and status in ('pending','active');
  update public.m4_output_intents set phase='stop_requested' where game_id=p_game_id;
  update public.broadcast_sessions set session_key=gen_random_uuid(),operation_generation=operation_generation+1,
    operation_token=p_operation_token,desired_state='live',status='preparing',lease_expires_at=clock_timestamp()+interval '30 seconds',
    youtube_broadcast_id=null,youtube_stream_id=null,provider_session_id=null,watch_url=null,
    youtube_channel_id=v_c.channel_id,youtube_connection_version=v_c.connection_version,
    youtube_broadcast_create_state='none',youtube_stream_create_state='none',livekit_egress_id=null,livekit_egress_create_state='none',
    uncertain_since=null,provider_step='m4-replacement-claimed',last_error_code=null,started_at=null,stopped_at=null,
    last_attempted_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=v_b.id returning * into v_b;
  return public.broadcast_session_json(v_b,'run',v_g.config,v_c.encrypted_credentials,v_c.channel_id,v_c.connection_version)||jsonb_build_object('transport','local-obs');
end $$;
revoke all on function public.begin_m4_replacement_cycle(uuid,uuid,boolean,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_m4_replacement_cycle(uuid,uuid,boolean,uuid) to service_role;

create or replace function public.claim_m4_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_b public.broadcast_sessions;
begin
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  select * into v_b from public.broadcast_sessions where game_id=p_game_id and provider='youtube';
  if p_desired_state='prepared' then
    if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i))
      then raise exception 'output delivery quarantined' using errcode='55000'; end if;
    if v_b.status='stopped' and v_b.desired_state='stopped' then
      return public.begin_m4_replacement_cycle(p_game_id,p_actor_user_id,p_verified_organizer,p_operation_token);
    end if;
  end if;
  return public.pre_quarantine_claim_m4_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,p_desired_state,p_operation_token);
end $$;

create or replace function public.approve_m4_desktop_pairing(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_code_hash text,p_challenge_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  perform 1 from public.games where id=p_game_id for update;
  perform 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i))
    then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  if exists(select 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' and operation_generation>0
    and (transport<>'local-obs' or desired_state<>'live' or status not in ('preparing','prepared')))
    then raise exception 'prepare a fresh cycle before pairing' using errcode='55000'; end if;
  return query select * from public.pre_quarantine_approve_m4_desktop_pairing(p_game_id,p_actor_user_id,p_verified_organizer,p_code_hash,p_challenge_hash);
end $$;
create or replace function public.claim_m4_output_intent(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,phase text,delivery_recorded boolean)
language plpgsql security definer set search_path='' as $$
declare v_broadcast public.broadcast_sessions; v_intent public.m4_output_intents;
begin
  if p_intent_id is null then raise exception 'invalid output intent' using errcode='22023'; end if;
  v_broadcast:=public.validate_m4_output_authority(p_game_id,p_session_id,p_generation,p_bearer_hash);
  select * into v_intent from public.m4_output_intents i where i.intent_id=p_intent_id for update;
  if found then
    if v_intent.game_id<>p_game_id or v_intent.session_id<>p_session_id or v_intent.generation<>p_generation or v_intent.organization_id<>v_broadcast.organization_id
      or v_intent.broadcast_generation<>v_broadcast.operation_generation or v_intent.youtube_broadcast_id<>v_broadcast.youtube_broadcast_id or v_intent.youtube_stream_id<>v_broadcast.youtube_stream_id
      or v_intent.provider_retirement_id is not null or v_intent.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  else
    if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i)) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
    if exists(select 1 from public.m4_output_intents i join public.m4_desktop_sessions s on s.session_id=i.session_id where i.game_id=p_game_id and i.phase='reserved' and s.status='active' and s.expires_at>now() and s.lease_expires_at>now()) then raise exception 'output already reserved' using errcode='55000'; end if;
    update public.m4_output_intents i set phase='stop_requested' where i.game_id=p_game_id and i.phase='reserved';
    insert into public.m4_output_intents(intent_id,game_id,organization_id,session_id,generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase)
      values(p_intent_id,p_game_id,v_broadcast.organization_id,p_session_id,p_generation,v_broadcast.operation_generation,v_broadcast.youtube_broadcast_id,v_broadcast.youtube_stream_id,'reserved') returning * into v_intent;
  end if;
  return query select v_intent.intent_id,v_intent.session_id,v_intent.generation,v_intent.phase,v_intent.delivery_recorded_at is not null;
end $$;
create or replace function public.mark_m4_output_delivery(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,phase text,delivery_recorded boolean)
language plpgsql security definer set search_path='' as $$
declare v_broadcast public.broadcast_sessions; v_intent public.m4_output_intents;
begin
  v_broadcast:=public.validate_m4_output_authority(p_game_id,p_session_id,p_generation,p_bearer_hash);
  select * into v_intent from public.m4_output_intents i where i.intent_id=p_intent_id for update;
  if not found or v_intent.game_id<>p_game_id or v_intent.session_id<>p_session_id or v_intent.generation<>p_generation or v_intent.organization_id<>v_broadcast.organization_id
    or v_intent.broadcast_generation<>v_broadcast.operation_generation or v_intent.youtube_broadcast_id<>v_broadcast.youtube_broadcast_id or v_intent.youtube_stream_id<>v_broadcast.youtube_stream_id
    or v_intent.provider_retirement_id is not null or v_intent.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.intent_id<>p_intent_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i)) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  update public.m4_output_intents i set delivery_recorded_at=coalesce(i.delivery_recorded_at,now()),phase='quarantined' where i.intent_id=p_intent_id returning * into v_intent;
  -- This safe receipt is NOT permission to fetch or redeliver a target.
  return query select v_intent.intent_id,v_intent.session_id,v_intent.generation,v_intent.phase,true;
end $$;


create or replace function public.m4_output_delivery_authority(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid,p_consume boolean)
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
    or v_i.provider_retirement_id is not null or v_i.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  select * into v_c from public.broadcast_settings c where c.organization_id=v_b.organization_id and c.provider='youtube' for update;
  if not found or v_c.connection_status<>'connected' or v_c.encrypted_credentials is null or v_c.channel_id is distinct from v_b.youtube_channel_id
    or v_c.channel_id is null or v_c.connection_version is null then raise exception 'youtube reconnect required' using errcode='55000'; end if;
  if v_s.expires_at<=clock_timestamp() or v_s.lease_expires_at<=clock_timestamp() then raise exception 'desktop authority expired' using errcode='42501'; end if;
  -- Reauthorize after all potentially blocking resource locks. A membership
  -- revocation committed while waiting must fence both consumption and assertion.
  if v_s.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_s.approved_by,false); end if;
  if p_consume then
    if v_i.phase<>'reserved' or exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i))
      then raise exception 'output delivery already consumed' using errcode='55000'; end if;
    update public.m4_output_intents i set phase='quarantined',delivery_recorded_at=clock_timestamp(),delivery_channel_id=v_c.channel_id,delivery_connection_version=v_c.connection_version
      where i.intent_id=p_intent_id returning * into v_i;
  else
    if v_i.phase<>'quarantined' or v_i.delivery_recorded_at is null or v_i.delivery_channel_id is distinct from v_c.channel_id
      or v_i.delivery_connection_version is distinct from v_c.connection_version then raise exception 'output delivery unavailable' using errcode='55000'; end if;
  end if;
  return query select v_i.intent_id,v_i.session_id,v_i.generation,v_i.organization_id,v_i.broadcast_generation,v_i.youtube_broadcast_id,v_i.youtube_stream_id,v_i.delivery_channel_id,v_i.delivery_connection_version,encode(v_c.encrypted_credentials,'base64'),v_s.expires_at,v_s.lease_expires_at;
end $$;


notify pgrst,'reload schema';
