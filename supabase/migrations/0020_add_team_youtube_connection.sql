-- Team-owned YouTube OAuth connection. Credentials remain service-only and
-- every operation derives its organization from a verified active account.
alter table public.broadcast_settings
  add column channel_id text check (channel_id is null or length(channel_id) between 1 and 128),
  add column channel_title text check (channel_title is null or length(channel_title) between 1 and 200),
  add column connection_status text not null default 'disconnected'
    check (connection_status in ('connected', 'reconnect_required', 'disconnected')),
  add column connection_version bigint not null default 0 check (connection_version >= 0),
  add column connected_by uuid references auth.users(id) on delete set null,
  add column connected_at timestamptz,
  add column tested_at timestamptz,
  add column last_error_code text,
  add column updated_at timestamptz not null default now();

create unique index broadcast_settings_organization_provider_unique
  on public.broadcast_settings(organization_id, provider)
  where provider = 'youtube';

create table public.youtube_oauth_states (
  state_hash text primary key check (length(state_hash) = 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  expected_version bigint not null check (expected_version >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index youtube_oauth_states_expiry_idx on public.youtube_oauth_states(expires_at);
alter table public.youtube_oauth_states enable row level security;
revoke all on public.youtube_oauth_states from public, anon, authenticated, service_role;

create function public.youtube_team(p_user_id uuid, p_manage boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_count integer;
begin
  if not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
  ) or not exists (
    select 1 from public.user_profiles where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'verified active account required' using errcode = '42501';
  end if;
  select count(*), min(organization_id::text)::uuid into v_count, v_org
    from public.team_memberships where user_id = p_user_id and status = 'active';
  if v_count <> 1 then
    raise exception 'exactly one active team required' using errcode = '42501';
  end if;
  if p_manage and not exists (
    select 1 from public.team_memberships where user_id = p_user_id
      and organization_id = v_org and status = 'active'
      and role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;
  return v_org;
end $$;

create function public.get_youtube_connection(p_user_id uuid)
returns table(
  channel_id text,
  channel_title text,
  connection_status text,
  connection_version bigint,
  connected_at timestamptz,
  tested_at timestamptz,
  last_error_code text,
  can_manage boolean
) language plpgsql security definer set search_path = '' stable as $$
declare v_org uuid := public.youtube_team(p_user_id, false);
begin
  return query
    select b.channel_id, b.channel_title, b.connection_status,
      b.connection_version, b.connected_at, b.tested_at, b.last_error_code,
      exists (
        select 1 from public.team_memberships m where m.user_id = p_user_id
          and m.organization_id = v_org and m.status = 'active'
          and m.role in ('owner', 'team_admin')
      )
    from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube';
end $$;

create function public.begin_youtube_oauth(
  p_user_id uuid, p_state_hash text, p_expires_at timestamptz
) returns table(organization_id uuid, expected_version bigint)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true); v_version bigint;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '15 minutes' then
    raise exception 'invalid oauth expiry' using errcode = '22023';
  end if;
  delete from public.youtube_oauth_states where expires_at <= now();
  select b.connection_version into v_version from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube';
  v_version := coalesce(v_version, 0);
  insert into public.youtube_oauth_states(
    state_hash, user_id, organization_id, expected_version, expires_at
  ) values (p_state_hash, p_user_id, v_org, v_version, p_expires_at);
  return query select v_org, v_version;
end $$;

create function public.consume_youtube_oauth(
  p_user_id uuid, p_state_hash text
) returns table(organization_id uuid, expected_version bigint)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true);
begin
  return query
    delete from public.youtube_oauth_states s
    where s.state_hash = p_state_hash and s.user_id = p_user_id
      and s.organization_id = v_org and s.expires_at > now()
    returning s.organization_id, s.expected_version;
end $$;

create function public.get_youtube_credentials(p_user_id uuid)
returns table(
  organization_id uuid,
  encrypted_credentials text,
  channel_id text,
  connection_version bigint
) language plpgsql security definer set search_path = '' stable as $$
declare v_org uuid := public.youtube_team(p_user_id, true);
begin
  return query
    select v_org, encode(b.encrypted_credentials, 'base64'), b.channel_id,
      b.connection_version
    from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube'
      and b.connection_status in ('connected', 'reconnect_required')
      and b.encrypted_credentials is not null and b.channel_id is not null;
end $$;

create function public.complete_youtube_connection(
  p_user_id uuid,
  p_expected_organization_id uuid,
  p_expected_version bigint,
  p_encrypted_credentials text,
  p_channel_id text,
  p_channel_title text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true); v_version bigint;
begin
  if v_org <> p_expected_organization_id then
    raise exception 'youtube organization changed' using errcode = '40001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':youtube', 20));
  select b.connection_version into v_version from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube' for update;
  if not found then
    if p_expected_version <> 0 then raise exception 'youtube connection changed' using errcode = '40001'; end if;
    insert into public.broadcast_settings(
      organization_id, provider, encrypted_credentials, channel_id, channel_title,
      connection_status, connection_version, connected_by, connected_at, tested_at, updated_at
    ) values (
      v_org, 'youtube', decode(p_encrypted_credentials, 'base64'),
      p_channel_id, p_channel_title, 'connected', 1, p_user_id, now(), now(), now()
    ) returning connection_version into v_version;
  else
    if v_version <> p_expected_version then raise exception 'youtube connection changed' using errcode = '40001'; end if;
    update public.broadcast_settings set
      encrypted_credentials = decode(p_encrypted_credentials, 'base64'),
      channel_id = p_channel_id,
      channel_title = p_channel_title,
      connection_status = 'connected',
      connection_version = connection_version + 1,
      connected_by = p_user_id,
      connected_at = now(), tested_at = now(), last_error_code = null,
      updated_at = now()
    where organization_id = v_org and provider = 'youtube'
    returning connection_version into v_version;
  end if;
  insert into public.audit_events(
    actor_user_id, organization_id, action, subject_type, subject_identifier, metadata
  ) values (
    p_user_id, v_org, 'youtube.connected', 'organization', v_org::text,
    jsonb_build_object('channel_id', p_channel_id, 'connection_version', v_version)
  );
  return v_version;
end $$;

create function public.finish_youtube_connection_test(
  p_user_id uuid, p_expected_organization_id uuid, p_expected_version bigint,
  p_ok boolean, p_error_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true);
begin
  if v_org <> p_expected_organization_id then
    raise exception 'youtube organization changed' using errcode = '40001';
  end if;
  update public.broadcast_settings set
    tested_at = now(),
    connection_status = case
      when p_ok then 'connected'
      when p_error_code in ('reconnect_required', 'channel_mismatch') then 'reconnect_required'
      else connection_status
    end,
    last_error_code = case when p_ok then null else coalesce(p_error_code, 'reconnect_required') end,
    updated_at = now()
  where organization_id = v_org and provider = 'youtube'
    and connection_version = p_expected_version
    and encrypted_credentials is not null;
  if not found then raise exception 'youtube connection changed' using errcode = '40001'; end if;
end $$;

create function public.disconnect_youtube_connection(p_user_id uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true); v_version bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':youtube', 20));
  insert into public.broadcast_settings(
    organization_id, provider, connection_status, connection_version, updated_at
  ) values (v_org, 'youtube', 'disconnected', 1, now())
  on conflict (organization_id, provider) where provider = 'youtube' do update set
    encrypted_credentials = null, channel_id = null, channel_title = null,
    connection_status = 'disconnected',
    connection_version = broadcast_settings.connection_version + 1,
    connected_by = null, connected_at = null, tested_at = null,
    last_error_code = null, updated_at = now()
  returning connection_version into v_version;
  delete from public.youtube_oauth_states where organization_id = v_org;
  insert into public.audit_events(
    actor_user_id, organization_id, action, subject_type, subject_identifier, metadata
  ) values (
    p_user_id, v_org, 'youtube.disconnected', 'organization', v_org::text,
    jsonb_build_object('connection_version', v_version)
  );
  return v_version;
end $$;

revoke all on function public.youtube_team(uuid,boolean),
  public.get_youtube_connection(uuid),
  public.begin_youtube_oauth(uuid,text,timestamptz),
  public.consume_youtube_oauth(uuid,text),
  public.get_youtube_credentials(uuid),
  public.complete_youtube_connection(uuid,uuid,bigint,text,text,text),
  public.finish_youtube_connection_test(uuid,uuid,bigint,boolean,text),
  public.disconnect_youtube_connection(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_youtube_connection(uuid),
  public.begin_youtube_oauth(uuid,text,timestamptz),
  public.consume_youtube_oauth(uuid,text),
  public.get_youtube_credentials(uuid),
  public.complete_youtube_connection(uuid,uuid,bigint,text,text,text),
  public.finish_youtube_connection_test(uuid,uuid,bigint,boolean,text),
  public.disconnect_youtube_connection(uuid)
to service_role;

notify pgrst, 'reload schema';
