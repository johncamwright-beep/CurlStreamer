-- Deletion closes retained application state and records recoverable metadata
-- in one state -> game transaction. Provider cleanup is durable but separate:
-- pending means only that LiveKit teardown still needs external proof.
create table public.game_deletion_cleanup (
  game_id uuid primary key references public.games(id) on delete restrict,
  provider text not null check (provider = 'livekit'),
  status text not null default 'pending'
    check (status in ('pending', 'failed', 'complete')),
  attempts integer not null default 0 check (attempts >= 0),
  requested_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  completed_at timestamptz,
  last_error text,
  check ((status = 'complete') = (completed_at is not null))
);

alter table public.game_deletion_cleanup enable row level security;
revoke all privileges on table public.game_deletion_cleanup
from public, anon, authenticated, service_role;

insert into public.game_deletion_cleanup(game_id, provider, status, requested_at)
select g.id, 'livekit', 'pending', g.deleted_at
from public.games g
where g.deleted_at is not null;

create or replace function public.soft_delete_team_game(
  p_user_id uuid,
  p_game_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
  v_game record;
  v_state jsonb;
  v_deleted_at timestamptz := now();
begin
  if not exists (
    select 1 from public.team_memberships m
    where m.user_id = p_user_id and m.organization_id = v_org
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;

  select gs.state into v_state
  from public.game_states gs
  where gs.game_id = p_game_id
  for update;
  if not found then return false; end if;

  select g.id, g.deleted_at, g.completed_at into v_game
  from public.games g
  where g.id = p_game_id and g.organization_id = v_org
  for update;
  if not found then return false; end if;

  if v_game.deleted_at is null and v_state->>'broadcast' = 'live' then
    raise exception 'stop the live session before deleting this game'
      using errcode = '55000';
  end if;

  -- Completion already froze and cleared its state. Deleting a completed game
  -- may change only the deletion metadata permitted by its terminal guard.
  -- The predicate also repairs partial deletions written by the legacy route
  -- without advancing the version again on an already-sanitized retry.
  if v_game.completed_at is null then
    update public.game_states
    set state = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        state, '{status}', '"closed"'::jsonb, true),
        '{claims}', '{}'::jsonb, true),
        '{connections}', '{"camera-home":false,"camera-away":false,"scorer":false}'::jsonb, true),
        '{cameraHealth}', '{}'::jsonb, true),
        '{broadcast}', '"idle"'::jsonb, true),
        '{audioMuted}', 'true'::jsonb, true),
        '{sponsorMode}', coalesce(state->'sponsorMode', '{}'::jsonb) ||
          '{"active":false,"paused":false,"startedAt":null,"mutedPrevious":false}'::jsonb, true),
        version = greatest(
          version + 1,
          (extract(epoch from clock_timestamp()) * 1000)::bigint
        ),
        updated_at = v_deleted_at
    where game_id = p_game_id
      and (
        state->>'status' is distinct from 'closed'
        or coalesce(state->'claims', '{}'::jsonb) <> '{}'::jsonb
        or coalesce(state->'connections', '{}'::jsonb) <>
          '{"camera-home":false,"camera-away":false,"scorer":false}'::jsonb
        or coalesce(state->'cameraHealth', '{}'::jsonb) <> '{}'::jsonb
        or state->>'broadcast' is distinct from 'idle'
        or state->>'audioMuted' is distinct from 'true'
        or state#>>'{sponsorMode,active}' is distinct from 'false'
        or state#>>'{sponsorMode,paused}' is distinct from 'false'
        or state#>>'{sponsorMode,startedAt}' is not null
        or state#>>'{sponsorMode,mutedPrevious}' is distinct from 'false'
      );
  end if;

  -- Support retrying cleanup for games deleted by an older application or an
  -- earlier request without duplicating deletion audit evidence.
  if v_game.deleted_at is not null then
    insert into public.game_deletion_cleanup(game_id, provider, status, requested_at)
    values (p_game_id, 'livekit', 'pending', v_game.deleted_at)
    on conflict (game_id) do nothing;
    return false;
  end if;

  update public.games
  set deleted_at = v_deleted_at,
      deleted_by_user_id = p_user_id
  where id = p_game_id;

  insert into public.game_deletion_cleanup(game_id, provider, status, requested_at)
  values (p_game_id, 'livekit', 'pending', v_deleted_at)
  on conflict (game_id) do update
  set status = 'pending',
      attempts = 0,
      requested_at = excluded.requested_at,
      last_attempted_at = null,
      completed_at = null,
      last_error = null;

  insert into public.audit_events(
    actor_user_id, organization_id, action,
    subject_type, subject_identifier, metadata
  )
  values (
    p_user_id, v_org, 'game.deleted',
    'game', p_game_id::text,
    jsonb_build_object('source', 'team_dashboard')
  );
  return true;
end;
$$;

create or replace function public.restore_team_game(
  p_user_id uuid,
  p_game_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
  v_game record;
begin
  if not exists (
    select 1 from public.team_memberships m
    where m.user_id = p_user_id and m.organization_id = v_org
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;

  perform 1 from public.game_states
  where game_id = p_game_id
  for update;
  if not found then return false; end if;

  select g.id, g.deleted_at, g.completed_at into v_game
  from public.games g
  where g.id = p_game_id and g.organization_id = v_org
  for update;
  if not found or v_game.deleted_at is null then return false; end if;

  -- A restore can be the first request to touch a row partially deleted by the
  -- previous application. Sanitize retained runtime state before making that
  -- row visible again; completed state remains protected and unchanged.
  if v_game.completed_at is null then
    update public.game_states
    set state = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
        state, '{status}', '"closed"'::jsonb, true),
        '{claims}', '{}'::jsonb, true),
        '{connections}', '{"camera-home":false,"camera-away":false,"scorer":false}'::jsonb, true),
        '{cameraHealth}', '{}'::jsonb, true),
        '{broadcast}', '"idle"'::jsonb, true),
        '{audioMuted}', 'true'::jsonb, true),
        '{sponsorMode}', coalesce(state->'sponsorMode', '{}'::jsonb) ||
          '{"active":false,"paused":false,"startedAt":null,"mutedPrevious":false}'::jsonb, true),
        version = greatest(
          version + 1,
          (extract(epoch from clock_timestamp()) * 1000)::bigint
        ),
        updated_at = now()
    where game_id = p_game_id
      and (
        state->>'status' is distinct from 'closed'
        or coalesce(state->'claims', '{}'::jsonb) <> '{}'::jsonb
        or coalesce(state->'connections', '{}'::jsonb) <>
          '{"camera-home":false,"camera-away":false,"scorer":false}'::jsonb
        or coalesce(state->'cameraHealth', '{}'::jsonb) <> '{}'::jsonb
        or state->>'broadcast' is distinct from 'idle'
        or state->>'audioMuted' is distinct from 'true'
        or state#>>'{sponsorMode,active}' is distinct from 'false'
        or state#>>'{sponsorMode,paused}' is distinct from 'false'
        or state#>>'{sponsorMode,startedAt}' is not null
        or state#>>'{sponsorMode,mutedPrevious}' is distinct from 'false'
      );
  end if;

  update public.games
  set deleted_at = null,
      deleted_by_user_id = null
  where id = p_game_id;

  insert into public.audit_events(
    actor_user_id, organization_id, action,
    subject_type, subject_identifier, metadata
  )
  values (
    p_user_id, v_org, 'game.restored',
    'game', p_game_id::text,
    jsonb_build_object('source', 'team_dashboard')
  );
  return true;
end;
$$;

-- Keep list_deleted_team_games(uuid) available for the previously deployed
-- application. The completion-foundation application uses this enriched,
-- service-only view so cleanup remains visible and retryable after a reload.
create function public.list_deleted_team_games_with_cleanup(p_user_id uuid)
returns table (
  game_id uuid,
  event_name text,
  home_name text,
  away_name text,
  created_at timestamptz,
  game_status text,
  deleted_at timestamptz,
  cleanup_status text,
  cleanup_attempts integer,
  cleanup_last_error text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  if not exists (
    select 1 from public.team_memberships m
    where m.user_id = p_user_id and m.organization_id = v_org
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;
  return query
    select g.id,
      coalesce(g.config->>'eventName', 'Untitled game'),
      coalesce(g.config->>'homeName', 'Home'),
      coalesce(g.config->>'awayName', 'Away'),
      g.created_at,
      coalesce(gs.state->>'status', g.status),
      g.deleted_at,
      coalesce(c.status, 'pending'),
      coalesce(c.attempts, 0),
      c.last_error
    from public.games g
    left join public.game_states gs on gs.game_id = g.id
    left join public.game_deletion_cleanup c on c.game_id = g.id
    where g.organization_id = v_org and g.deleted_at is not null
    order by g.deleted_at desc, g.id;
end;
$$;

create function public.get_game_deletion_cleanup(
  p_user_id uuid,
  p_game_id uuid
)
returns table (status text, attempts integer, last_error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  if not exists (
    select 1 from public.team_memberships m
    where m.user_id = p_user_id and m.organization_id = v_org
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;
  return query
    select c.status, c.attempts, c.last_error
    from public.game_deletion_cleanup c
    join public.games g on g.id = c.game_id
    where c.game_id = p_game_id and g.organization_id = v_org
      and g.deleted_at is not null;
end;
$$;

create function public.record_game_deletion_cleanup(
  p_user_id uuid,
  p_game_id uuid,
  p_succeeded boolean,
  p_error text
)
returns table (status text, attempts integer, last_error text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  if not exists (
    select 1 from public.team_memberships m
    where m.user_id = p_user_id and m.organization_id = v_org
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administrator required' using errcode = '42501';
  end if;
  update public.game_deletion_cleanup c
  set attempts = c.attempts + 1,
      last_attempted_at = now(),
      status = case when p_succeeded then 'complete' else 'failed' end,
      last_error = case
        when p_succeeded then null
        else left(
          coalesce(nullif(p_error, ''), 'Provider cleanup was not confirmed'),
          500
        )
      end,
      completed_at = case when p_succeeded then now() else null end
  where c.game_id = p_game_id
    and c.status <> 'complete'
    and exists (
      select 1 from public.games g
      where g.id = c.game_id and g.organization_id = v_org
        and g.deleted_at is not null
    );
  return query
    select c.status, c.attempts, c.last_error
    from public.game_deletion_cleanup c
    join public.games g on g.id = c.game_id
    where c.game_id = p_game_id and g.organization_id = v_org
      and g.deleted_at is not null;
end;
$$;

revoke all privileges on function
  public.list_deleted_team_games_with_cleanup(uuid),
  public.get_game_deletion_cleanup(uuid, uuid),
  public.record_game_deletion_cleanup(uuid, uuid, boolean, text)
from public, anon, authenticated, service_role;

grant execute on function
  public.list_deleted_team_games_with_cleanup(uuid),
  public.get_game_deletion_cleanup(uuid, uuid),
  public.record_game_deletion_cleanup(uuid, uuid, boolean, text)
to service_role;

notify pgrst, 'reload schema';
