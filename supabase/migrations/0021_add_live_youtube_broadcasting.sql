-- Durable, service-only orchestration state for one YouTube broadcast per game.
-- Provider calls happen outside these transactions. Every writer follows the
-- established game_states -> games -> broadcast_sessions lock order.
alter table public.broadcast_sessions
  add column organization_id uuid references public.organizations(id) on delete restrict,
  add column session_key uuid not null default gen_random_uuid(),
  add column desired_state text not null default 'stopped'
    check (desired_state in ('live', 'stopped')),
  add column operation_generation bigint not null default 0
    check (operation_generation >= 0),
  add column operation_token uuid,
  add column lease_expires_at timestamptz,
  add column youtube_broadcast_id text,
  add column youtube_stream_id text,
  add column livekit_egress_id text,
  add column youtube_channel_id text,
  add column youtube_connection_version bigint,
  add column provider_step text,
  add column uncertain_since timestamptz,
  add column youtube_broadcast_create_state text not null default 'none'
    check (youtube_broadcast_create_state in ('none', 'intent', 'ready', 'uncertain')),
  add column youtube_stream_create_state text not null default 'none'
    check (youtube_stream_create_state in ('none', 'intent', 'ready', 'uncertain')),
  add column livekit_egress_create_state text not null default 'none'
    check (livekit_egress_create_state in ('none', 'intent', 'ready', 'uncertain')),
  add column watch_url text check (public.is_valid_youtube_watch_url(watch_url)),
  add column last_error_code text,
  add column last_attempted_at timestamptz,
  add column updated_at timestamptz not null default now();

update public.broadcast_sessions s
set organization_id = g.organization_id,
    desired_state = case when s.status = 'live' then 'live' else 'stopped' end,
    status = case when s.status = 'live' then 'live' else 'stopped' end
from public.games g
where g.id = s.game_id;

alter table public.broadcast_sessions alter column organization_id set not null;
alter table public.broadcast_sessions
  add constraint broadcast_sessions_status_check
  check (status in ('idle', 'preparing', 'live', 'stopping', 'stopped', 'failed'));
create unique index broadcast_sessions_game_youtube_unique
  on public.broadcast_sessions(game_id, provider) where provider = 'youtube';
create unique index broadcast_sessions_session_key_unique
  on public.broadcast_sessions(session_key);

create function public.authorize_game_broadcast_actor(
  p_game_id uuid, p_actor_user_id uuid, p_verified_organizer boolean
) returns table(organization_id uuid, actor_kind text)
language plpgsql security definer set search_path = '' stable as $$
declare v_org uuid;
begin
  select g.organization_id into v_org from public.games g where g.id = p_game_id;
  if not found then raise exception 'game unavailable' using errcode = '42501'; end if;
  if p_verified_organizer then
    return query select v_org, 'organizer'::text;
    return;
  end if;
  if p_actor_user_id is null or not exists (
    select 1 from auth.users u
    join public.user_profiles p on p.user_id = u.id and p.status = 'active'
    join public.team_memberships m on m.user_id = u.id
      and m.organization_id = v_org and m.status = 'active'
      and m.role in ('owner', 'team_admin')
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'verified team administrator required' using errcode = '42501';
  end if;
  return query select v_org, 'account'::text;
end $$;

create function public.broadcast_session_json(
  p_session public.broadcast_sessions, p_action text default null,
  p_config jsonb default null, p_credentials bytea default null,
  p_channel_id text default null, p_connection_version bigint default null
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'action', p_action,
    'gameId', p_session.game_id,
    'organizationId', p_session.organization_id,
    'sessionKey', p_session.session_key,
    'generation', p_session.operation_generation,
    'operationToken', p_session.operation_token,
    'desiredState', p_session.desired_state,
    'status', p_session.status,
    'youtubeBroadcastId', p_session.youtube_broadcast_id,
    'youtubeStreamId', p_session.youtube_stream_id,
    'livekitEgressId', p_session.livekit_egress_id,
    'savedChannelId', p_session.youtube_channel_id,
    'watchUrl', p_session.watch_url,
    'lastErrorCode', p_session.last_error_code,
    'providerStep', p_session.provider_step,
    'uncertainSince', p_session.uncertain_since,
    'youtubeBroadcastCreateState', p_session.youtube_broadcast_create_state,
    'youtubeStreamCreateState', p_session.youtube_stream_create_state,
    'livekitEgressCreateState', p_session.livekit_egress_create_state,
    'title', p_config->>'youtubeTitle',
    'visibility', p_config->>'youtubeVisibility',
    'encryptedCredentials', case when p_credentials is null then null
      else encode(p_credentials, 'base64') end,
    'channelId', p_channel_id,
    'connectionVersion', p_connection_version
  ));
$$;

create function public.get_game_broadcast_session(
  p_game_id uuid, p_actor_user_id uuid, p_verified_organizer boolean
) returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare v_session public.broadcast_sessions; v_settings record;
begin
  perform 1 from public.authorize_game_broadcast_actor(
    p_game_id, p_actor_user_id, p_verified_organizer);
  select * into v_session from public.broadcast_sessions s
    where s.game_id = p_game_id and s.provider = 'youtube';
  if not found then return jsonb_build_object(
    'gameId', p_game_id, 'desiredState', 'stopped', 'status', 'idle'); end if;
  select * into v_settings from public.broadcast_settings b
    where b.organization_id = v_session.organization_id and b.provider = 'youtube'
      and b.channel_id = v_session.youtube_channel_id
      and b.encrypted_credentials is not null;
  return public.broadcast_session_json(
    v_session, null, null, v_settings.encrypted_credentials,
    v_settings.channel_id, v_settings.connection_version);
end $$;

create function public.claim_game_broadcast_operation(
  p_game_id uuid, p_actor_user_id uuid, p_verified_organizer boolean,
  p_desired_state text, p_operation_token uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game record; v_actor record; v_session public.broadcast_sessions;
  v_settings record; v_action text := 'run';
begin
  if p_desired_state not in ('live', 'stopped') then
    raise exception 'invalid broadcast intent' using errcode = '22023';
  end if;
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game unavailable' using errcode = '55000'; end if;
  select * into v_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game unavailable' using errcode = '42501'; end if;
  select * into v_actor from public.authorize_game_broadcast_actor(
    p_game_id, p_actor_user_id, p_verified_organizer);

  if p_desired_state = 'live' and (
    v_game.deleted_at is not null or v_game.completed_at is not null
    or v_game.status in ('closed', 'completed')
    or (select gs.state->>'status' from public.game_states gs
        where gs.game_id = p_game_id) in ('closed', 'completed')
  ) then raise exception 'terminal game cannot broadcast' using errcode = '55000'; end if;

  select * into v_session from public.broadcast_sessions s
    where s.game_id = p_game_id and s.provider = 'youtube' for update;
  if not found then
    insert into public.broadcast_sessions(
      game_id, organization_id, provider, status, desired_state
    ) values (p_game_id, v_game.organization_id, 'youtube', 'idle', 'stopped')
    returning * into v_session;
  end if;

  if p_desired_state = 'live' then
    select * into v_settings from public.broadcast_settings b
      where b.organization_id = v_game.organization_id and b.provider = 'youtube'
        and b.connection_status = 'connected' and b.encrypted_credentials is not null
        and b.channel_id is not null for update;
    if not found then raise exception 'youtube reconnect required' using errcode = '55000'; end if;
    if v_session.desired_state = 'stopped' and v_session.operation_generation > 0 then
      raise exception 'stopped broadcast cannot restart' using errcode = '55000';
    end if;
    if v_session.youtube_channel_id is not null
      and v_session.youtube_channel_id <> v_settings.channel_id then
      raise exception 'youtube channel changed' using errcode = '55000';
    end if;
    if v_session.desired_state = 'live' and v_session.status = 'live' then
      v_action := 'none';
    elsif v_session.desired_state = 'live' and v_session.status = 'preparing'
      and v_session.lease_expires_at > now() then
      v_action := 'wait';
    else
      update public.broadcast_sessions s set
        desired_state = 'live', status = 'preparing',
        operation_generation = s.operation_generation + 1,
        operation_token = p_operation_token,
        lease_expires_at = now() + interval '30 seconds',
        youtube_channel_id = coalesce(s.youtube_channel_id, v_settings.channel_id),
        youtube_connection_version = coalesce(s.youtube_connection_version, v_settings.connection_version),
        last_attempted_at = now(), last_error_code = null, updated_at = now()
      where s.id = v_session.id returning * into v_session;
    end if;
  else
    if v_session.desired_state = 'stopped' and v_session.status in ('idle', 'stopped') then
      v_action := 'none';
    elsif v_session.desired_state = 'stopped' and v_session.status = 'stopping'
      and v_session.lease_expires_at > now() then
      v_action := 'wait';
    else
      update public.broadcast_sessions s set
        desired_state = 'stopped', status = 'stopping',
        operation_generation = s.operation_generation + 1,
        operation_token = p_operation_token,
        lease_expires_at = now() + interval '30 seconds',
        last_attempted_at = now(), last_error_code = null, updated_at = now()
      where s.id = v_session.id returning * into v_session;
    end if;
    select * into v_settings from public.broadcast_settings b
      where b.organization_id = v_game.organization_id and b.provider = 'youtube'
        and b.encrypted_credentials is not null and b.channel_id is not null;
    if v_session.youtube_channel_id is not null and found
      and v_session.youtube_channel_id <> v_settings.channel_id then
      raise exception 'original youtube channel unavailable' using errcode = '55000';
    end if;
  end if;

  return public.broadcast_session_json(
    v_session, v_action, v_game.config, v_settings.encrypted_credentials,
    v_settings.channel_id, v_settings.connection_version);
end $$;

create function public.record_game_broadcast_operation(
  p_game_id uuid, p_generation bigint, p_operation_token uuid,
  p_status text, p_youtube_broadcast_id text default null,
  p_youtube_stream_id text default null, p_livekit_egress_id text default null,
  p_watch_url text default null, p_error_code text default null,
  p_provider_step text default null, p_uncertain boolean default false,
  p_youtube_broadcast_create_state text default null,
  p_youtube_stream_create_state text default null,
  p_livekit_egress_create_state text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_session public.broadcast_sessions;
begin
  if p_status not in ('preparing', 'live', 'stopping', 'stopped', 'failed')
    or not public.is_valid_youtube_watch_url(p_watch_url) then
    raise exception 'invalid broadcast state' using errcode = '22023';
  end if;
  if coalesce(p_youtube_broadcast_create_state, 'none') not in ('none', 'intent', 'ready', 'uncertain')
    or coalesce(p_youtube_stream_create_state, 'none') not in ('none', 'intent', 'ready', 'uncertain')
    or coalesce(p_livekit_egress_create_state, 'none') not in ('none', 'intent', 'ready', 'uncertain') then
    raise exception 'invalid provider creation state' using errcode = '22023';
  end if;
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game unavailable' using errcode = '55000'; end if;
  perform 1 from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game unavailable' using errcode = '55000'; end if;
  select * into v_session from public.broadcast_sessions s
    where s.game_id = p_game_id and s.provider = 'youtube' for update;
  if not found or v_session.operation_generation <> p_generation
    or v_session.operation_token is distinct from p_operation_token then return null; end if;
  if (p_status in ('preparing', 'live') and v_session.desired_state <> 'live')
    or (p_status in ('stopping', 'stopped') and v_session.desired_state <> 'stopped') then
    return null;
  end if;
  update public.broadcast_sessions s set
    status = p_status,
    youtube_broadcast_id = coalesce(p_youtube_broadcast_id, s.youtube_broadcast_id),
    youtube_stream_id = coalesce(p_youtube_stream_id, s.youtube_stream_id),
    livekit_egress_id = coalesce(p_livekit_egress_id, s.livekit_egress_id),
    provider_session_id = coalesce(p_youtube_broadcast_id, s.provider_session_id),
    watch_url = coalesce(p_watch_url, s.watch_url),
    last_error_code = case when p_status in ('live', 'stopped') then null
      else left(p_error_code, 160) end,
    provider_step = p_provider_step,
    youtube_broadcast_create_state = coalesce(
      p_youtube_broadcast_create_state, s.youtube_broadcast_create_state),
    youtube_stream_create_state = coalesce(
      p_youtube_stream_create_state, s.youtube_stream_create_state),
    livekit_egress_create_state = coalesce(
      p_livekit_egress_create_state, s.livekit_egress_create_state),
    uncertain_since = case when p_uncertain then coalesce(s.uncertain_since, now())
      when p_error_code is null then null else s.uncertain_since end,
    started_at = case when p_status = 'live' then coalesce(s.started_at, now()) else s.started_at end,
    stopped_at = case when p_status = 'stopped' then now() else s.stopped_at end,
    lease_expires_at = case when p_status in ('live', 'stopped', 'failed') then null
      else now() + interval '30 seconds' end,
    updated_at = now()
  where s.id = v_session.id returning * into v_session;
  if p_status = 'live' then
    update public.game_states set
      state = jsonb_set(state, '{broadcast}', '"live"'::jsonb, true),
      version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
      updated_at = now() where game_id = p_game_id;
  elsif p_status = 'stopped' then
    update public.game_states set
      state = jsonb_set(state, '{broadcast}', '"idle"'::jsonb, true),
      version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
      updated_at = now() where game_id = p_game_id and state->>'broadcast' <> 'idle';
  end if;
  return public.broadcast_session_json(v_session);
end $$;

-- Terminal database writes synchronously fence an in-flight start. A late
-- provider response cannot pass the generation/token compare-and-set above.
create function public.fence_terminal_game_broadcast()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.completed_at is null and new.completed_at is not null)
    or (old.deleted_at is null and new.deleted_at is not null) then
    update public.broadcast_sessions set desired_state = 'stopped',
      status = case when status in ('idle', 'stopped') then 'stopped' else 'stopping' end,
      operation_generation = operation_generation + 1,
      operation_token = null, lease_expires_at = null, updated_at = now()
    where game_id = new.id and provider = 'youtube';
  end if;
  return new;
end $$;
create trigger fence_terminal_game_broadcast
after update of completed_at, deleted_at on public.games
for each row execute function public.fence_terminal_game_broadcast();

-- An unfinished session must retain the credentials for its original channel
-- so Stop/recovery can act on the resources it created.
create function public.guard_youtube_connection_in_use()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.broadcast_sessions s
    where s.organization_id = old.organization_id and s.provider = 'youtube'
      and s.status not in ('idle', 'stopped')
  ) and (
    new.channel_id is distinct from old.channel_id
    or (old.encrypted_credentials is not null and new.encrypted_credentials is null)
  ) then
    raise exception 'youtube connection has an unfinished broadcast'
      using errcode = '55000';
  end if;
  return new;
end $$;
create trigger guard_youtube_connection_in_use
before update on public.broadcast_settings
for each row when (old.provider = 'youtube')
execute function public.guard_youtube_connection_in_use();

-- The provider-created watch URL is authoritative when a completion is saved.
create or replace function public.copy_review_watch_url_to_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(s.watch_url, r.youtube_watch_url) into new.youtube_watch_url
  from public.game_completion_reviews r
  left join public.broadcast_sessions s on s.game_id = r.game_id and s.provider = 'youtube'
  where r.id = new.review_id;
  return new;
end $$;

revoke all on function
  public.authorize_game_broadcast_actor(uuid,uuid,boolean),
  public.broadcast_session_json(public.broadcast_sessions,text,jsonb,bytea,text,bigint),
  public.get_game_broadcast_session(uuid,uuid,boolean),
  public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid),
  public.record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text),
  public.fence_terminal_game_broadcast(),
  public.guard_youtube_connection_in_use()
from public, anon, authenticated, service_role;
grant execute on function
  public.get_game_broadcast_session(uuid,uuid,boolean),
  public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid),
  public.record_game_broadcast_operation(uuid,bigint,uuid,text,text,text,text,text,text,text,boolean,text,text,text)
to service_role;

notify pgrst, 'reload schema';
