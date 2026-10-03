begin;

-- CurlCoach is a private, optional module.  Neither a team role nor a test
-- billing record implies access: an organization must have an explicit module
-- entitlement and the acting account must have an explicit coach grant.
create table public.curlcoach_module_entitlements (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  module_key text not null default 'curlcoach' check (module_key = 'curlcoach'),
  expires_at timestamptz,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.curlcoach_coach_access (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz,
  granted_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index curlcoach_coach_access_active_user_idx
  on public.curlcoach_coach_access(user_id, organization_id);

create table public.curlcoach_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  game_id uuid not null references public.games(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null check (status in ('open', 'closed')),
  revision bigint not null check (revision >= 0),
  state jsonb not null check (jsonb_typeof(state) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (organization_id, game_id, actor_user_id),
  check ((status = 'closed') = (closed_at is not null))
);
create index curlcoach_sessions_actor_game_idx
  on public.curlcoach_sessions(actor_user_id, game_id, updated_at desc);

-- Commands are never rewritten or removed.  `result_state` gives a retry the
-- exact committed result even if a later command has already advanced session
-- state.
create table public.curlcoach_commands (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.curlcoach_sessions(id) on delete cascade,
  request_id uuid not null,
  expected_revision bigint not null check (expected_revision >= 0),
  revision bigint not null check (revision > expected_revision),
  command_type text not null check (command_type in ('command', 'finish', 'reopen')),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  result_state jsonb not null check (jsonb_typeof(result_state) = 'object'),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (session_id, request_id),
  unique (session_id, revision)
);

create function public.reject_curlcoach_command_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'curlcoach_commands_append_only' using errcode = '55000';
end;
$$;
create trigger curlcoach_commands_append_only
before update or delete on public.curlcoach_commands
for each row execute function public.reject_curlcoach_command_mutation();

alter table public.curlcoach_module_entitlements enable row level security;
alter table public.curlcoach_coach_access enable row level security;
alter table public.curlcoach_sessions enable row level security;
alter table public.curlcoach_commands enable row level security;
revoke all on table
  public.curlcoach_module_entitlements,
  public.curlcoach_coach_access,
  public.curlcoach_sessions,
  public.curlcoach_commands
from public, anon, authenticated, service_role;

create function public.assert_curlcoach_actor(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users u
    join public.user_profiles p on p.user_id = u.id and p.status = 'active'
    join public.team_memberships m on m.user_id = u.id
      and m.organization_id = p_organization_id and m.status = 'active'
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'active team account required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.games
    where id = p_game_id and organization_id = p_organization_id
  ) then
    raise exception 'game unavailable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.curlcoach_module_entitlements
    where organization_id = p_organization_id and module_key = 'curlcoach'
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'curlcoach entitlement required' using errcode = 'P0402';
  end if;
  if not exists (
    select 1 from public.curlcoach_coach_access
    where organization_id = p_organization_id and user_id = p_actor_user_id
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'explicit curlcoach access required' using errcode = '42501';
  end if;
end;
$$;

-- Listing an event must fail closed before its games are read. This deliberately
-- does not accept a game identifier, while command/read RPCs additionally bind
-- a private session to a game in this same organization.
create function public.assert_curlcoach_access(
  p_actor_user_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users u
    join public.user_profiles p on p.user_id = u.id and p.status = 'active'
    join public.team_memberships m on m.user_id = u.id
      and m.organization_id = p_organization_id and m.status = 'active'
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'active team account required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.curlcoach_module_entitlements
    where organization_id = p_organization_id and module_key = 'curlcoach'
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'curlcoach entitlement required' using errcode = 'P0402';
  end if;
  if not exists (
    select 1 from public.curlcoach_coach_access
    where organization_id = p_organization_id and user_id = p_actor_user_id
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'explicit curlcoach access required' using errcode = '42501';
  end if;
end;
$$;

create function public.read_curlcoach_state(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state jsonb;
begin
  perform public.assert_curlcoach_actor(p_actor_user_id, p_organization_id, p_game_id);
  select state into v_state from public.curlcoach_sessions
  where organization_id = p_organization_id and game_id = p_game_id
    and actor_user_id = p_actor_user_id;
  return v_state;
end;
$$;

create function public.apply_curlcoach_command(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_command_type text,
  p_payload jsonb,
  p_next_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.curlcoach_sessions%rowtype;
  v_command public.curlcoach_commands%rowtype;
  v_session_found boolean := false;
  v_next_revision bigint;
  v_next_status text;
  v_current_events jsonb;
  v_next_events jsonb;
begin
  if p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or coalesce(p_command_type, '') not in ('command', 'finish', 'reopen')
    or coalesce(jsonb_typeof(p_payload), '') <> 'object'
    or coalesce(jsonb_typeof(p_next_state), '') <> 'object' then
    raise exception 'invalid curlcoach command' using errcode = '22023';
  end if;
  perform public.assert_curlcoach_actor(p_actor_user_id, p_organization_id, p_game_id);

  select * into v_session from public.curlcoach_sessions
  where organization_id = p_organization_id and game_id = p_game_id
    and actor_user_id = p_actor_user_id
  for update;
  v_session_found := found;

  if v_session_found then
    select * into v_command from public.curlcoach_commands
    where session_id = v_session.id and request_id = p_request_id;
    if found then
      if v_command.expected_revision <> p_expected_revision
        or v_command.command_type <> p_command_type
        or v_command.payload <> p_payload then
        raise exception 'curlcoach request id already used' using errcode = '23505';
      end if;
      return v_command.result_state;
    end if;
  elsif p_expected_revision <> 0 then
    raise exception 'curlcoach revision conflict' using errcode = '40001';
  end if;

  v_next_revision := p_expected_revision + 1;
  if coalesce(p_next_state ->> 'organizationId', '') <> p_organization_id::text
    or coalesce(p_next_state ->> 'gameId', '') <> p_game_id::text
    or coalesce(p_next_state ->> 'profile', '') <> 'tracker-provisional-v1'
    or coalesce(p_next_state ->> 'revision', '') !~ '^[0-9]+$'
    or (p_next_state ->> 'revision')::bigint <> v_next_revision
    or coalesce(p_next_state ->> 'status', '') not in ('open', 'closed')
    or jsonb_typeof(p_next_state -> 'events') <> 'array'
    or jsonb_typeof(p_next_state -> 'roster') <> 'array' then
    raise exception 'invalid curlcoach state' using errcode = '22023';
  end if;

  if v_session_found and v_session.revision <> p_expected_revision then
    raise exception 'curlcoach revision conflict' using errcode = '40001';
  end if;
  v_current_events := coalesce(v_session.state -> 'events', '[]'::jsonb);
  v_next_events := p_next_state -> 'events';
  if v_session_found and p_next_state -> 'roster' <> v_session.state -> 'roster' then
    raise exception 'curlcoach roster snapshot is immutable' using errcode = '22023';
  end if;

  if p_command_type = 'command' then
    if (v_session_found and v_session.status <> 'open')
      or coalesce(p_payload ->> 'requestId', '') <> p_request_id::text
      or coalesce(p_payload ->> 'expectedRevision', '') !~ '^[0-9]+$'
      or (p_payload ->> 'expectedRevision')::bigint <> p_expected_revision
      or coalesce(p_next_state ->> 'status', '') <> 'open'
      or jsonb_array_length(v_next_events) <> jsonb_array_length(v_current_events) + 1
      or coalesce(v_next_events -> -1 ->> 'requestId', '') <> p_request_id::text then
      raise exception 'invalid curlcoach shot command' using errcode = '22023';
    end if;
    v_next_status := 'open';
  elsif p_command_type = 'finish' then
    if (v_session_found and v_session.status <> 'open')
      or coalesce(p_next_state ->> 'status', '') <> 'closed'
      or v_next_events <> v_current_events then
      raise exception 'invalid curlcoach finish command' using errcode = '22023';
    end if;
    v_next_status := 'closed';
  else
    if not v_session_found or v_session.status <> 'closed'
      or coalesce(p_next_state ->> 'status', '') <> 'open'
      or v_next_events <> v_current_events then
      raise exception 'invalid curlcoach reopen command' using errcode = '22023';
    end if;
    v_next_status := 'open';
  end if;

  if not v_session_found then
    insert into public.curlcoach_sessions(
      organization_id, game_id, actor_user_id, status, revision, state, closed_at
    ) values (
      p_organization_id, p_game_id, p_actor_user_id, v_next_status,
      v_next_revision, p_next_state,
      case when v_next_status = 'closed' then now() else null end
    ) returning * into v_session;
  else
    update public.curlcoach_sessions set
      status = v_next_status,
      revision = v_next_revision,
      state = p_next_state,
      updated_at = now(),
      closed_at = case when v_next_status = 'closed' then now() else null end
    where id = v_session.id
    returning * into v_session;
  end if;

  insert into public.curlcoach_commands(
    session_id, request_id, expected_revision, revision, command_type,
    payload, result_state, actor_user_id
  ) values (
    v_session.id, p_request_id, p_expected_revision, v_next_revision,
    p_command_type, p_payload, p_next_state, p_actor_user_id
  );
  return p_next_state;
end;
$$;

create function public.grant_curlcoach_access(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid; v_count integer; v_platform boolean := public.is_platform_admin(p_actor_user_id);
begin
  if v_platform then
    select count(*), min(organization_id::text)::uuid into v_count, v_org
    from public.team_memberships where user_id = p_target_user_id and status = 'active';
    if v_count <> 1 then raise exception 'target must have exactly one active team' using errcode = '42501'; end if;
  else
    v_org := public.verified_team_for_operation(p_actor_user_id, false);
    if not exists (
      select 1 from auth.users u
      join public.user_profiles p on p.user_id = u.id and p.status = 'active'
      join public.team_memberships m on m.user_id = u.id
        and m.organization_id = v_org and m.status = 'active'
        and m.role in ('owner', 'team_admin')
      where u.id = p_actor_user_id and u.email_confirmed_at is not null
    ) then raise exception 'team administrator required' using errcode = '42501'; end if;
  end if;
  if not exists (
    select 1 from auth.users u join public.user_profiles p on p.user_id = u.id
    join public.team_memberships m on m.user_id = u.id and m.organization_id = v_org
      and m.status = 'active'
    where u.id = p_target_user_id and p.status = 'active' and u.email_confirmed_at is not null
  ) then raise exception 'active team account required' using errcode = '42501'; end if;
  insert into public.curlcoach_coach_access(
    organization_id, user_id, expires_at, granted_by_user_id
  ) values (v_org, p_target_user_id, p_expires_at, p_actor_user_id)
  on conflict (organization_id, user_id) do update set
    expires_at = excluded.expires_at, granted_by_user_id = excluded.granted_by_user_id,
    updated_at = now();
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_actor_user_id, v_org, 'curlcoach.access.granted', 'user', p_target_user_id::text,
    jsonb_build_object('expires_at', p_expires_at));
end;
$$;

create function public.revoke_curlcoach_access(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid; v_count integer; v_platform boolean := public.is_platform_admin(p_actor_user_id);
begin
  if v_platform then
    select count(*), min(organization_id::text)::uuid into v_count, v_org
    from public.team_memberships where user_id = p_target_user_id and status = 'active';
    if v_count <> 1 then raise exception 'target must have exactly one active team' using errcode = '42501'; end if;
  else
    v_org := public.verified_team_for_operation(p_actor_user_id, false);
    if not exists (
      select 1 from auth.users u join public.user_profiles p on p.user_id = u.id
      join public.team_memberships m on m.user_id = u.id and m.organization_id = v_org
        and m.status = 'active' and m.role in ('owner', 'team_admin')
      where u.id = p_actor_user_id and p.status = 'active' and u.email_confirmed_at is not null
    ) then raise exception 'team administrator required' using errcode = '42501'; end if;
  end if;
  delete from public.curlcoach_coach_access
  where organization_id = v_org and user_id = p_target_user_id;
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_actor_user_id, v_org, 'curlcoach.access.revoked', 'user', p_target_user_id::text, '{}'::jsonb);
end;
$$;

create function public.set_curlcoach_entitlement(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_expires_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.require_platform_admin(p_actor_user_id);
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'organization unavailable' using errcode = '22023';
  end if;
  insert into public.curlcoach_module_entitlements(
    organization_id, expires_at, granted_by_user_id
  ) values (p_organization_id, p_expires_at, p_actor_user_id)
  on conflict (organization_id) do update set
    expires_at = excluded.expires_at, granted_by_user_id = excluded.granted_by_user_id,
    updated_at = now();
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_actor_user_id, p_organization_id, 'curlcoach.entitlement.set', 'organization',
    p_organization_id::text, jsonb_build_object('expires_at', p_expires_at));
end;
$$;

revoke all on function
  public.assert_curlcoach_actor(uuid, uuid, uuid),
  public.assert_curlcoach_access(uuid, uuid),
  public.read_curlcoach_state(uuid, uuid, uuid),
  public.apply_curlcoach_command(uuid, uuid, uuid, uuid, bigint, text, jsonb, jsonb),
  public.grant_curlcoach_access(uuid, uuid, timestamptz),
  public.revoke_curlcoach_access(uuid, uuid),
  public.set_curlcoach_entitlement(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function
  public.assert_curlcoach_access(uuid, uuid),
  public.read_curlcoach_state(uuid, uuid, uuid),
  public.apply_curlcoach_command(uuid, uuid, uuid, uuid, bigint, text, jsonb, jsonb),
  public.grant_curlcoach_access(uuid, uuid, timestamptz),
  public.revoke_curlcoach_access(uuid, uuid),
  public.set_curlcoach_entitlement(uuid, uuid, timestamptz)
to service_role;

notify pgrst, 'reload schema';
commit;
