-- Create authenticated games inside an existing team without changing the
-- legacy create_game function or any existing game records.
create function public.create_team_game(
  p_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid,
  p_config jsonb,
  p_state jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_organization_id uuid;
  active_membership_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 0));

  if not exists (
    select 1 from public.user_profiles
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select count(*) into active_membership_count
  from public.team_memberships
  where user_id = p_user_id and status = 'active';

  if active_membership_count = 0 then
    raise exception 'team setup required' using errcode = 'P0001';
  elsif active_membership_count > 1 then
    raise exception 'team selection required' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.team_memberships
    where user_id = p_user_id
      and organization_id = p_organization_id
      and status = 'active'
      and role in ('owner', 'team_admin', 'scorer')
  ) then
    raise exception 'permitted active team membership required' using errcode = '42501';
  end if;

  select organization_id into existing_organization_id
  from public.games where id = p_game_id;
  if found then
    if existing_organization_id <> p_organization_id then
      raise exception 'game identifier belongs to another organization' using errcode = '23505';
    end if;
    if not exists (select 1 from public.game_states where game_id = p_game_id) then
      raise exception 'existing game has no initial state' using errcode = '23514';
    end if;
    return;
  end if;

  -- Compatibility only: legacy game policies expect the creator to occur here.
  -- Authorization above is exclusively based on the active account membership.
  insert into public.organizer_users (organization_id, user_id)
  values (p_organization_id, p_user_id)
  on conflict (organization_id, user_id) do nothing;

  insert into public.games (id, organization_id, config, status, created_by)
  values (p_game_id, p_organization_id, p_config, 'active', p_user_id);

  insert into public.game_states (game_id, state)
  values (p_game_id, p_state);

  insert into public.audit_events (
    actor_user_id, organization_id, action, subject_type,
    subject_identifier, metadata
  ) values (
    p_user_id, p_organization_id, 'game.created', 'game', p_game_id::text,
    jsonb_build_object('source', 'authenticated_team_creation')
  );
end;
$$;

revoke all privileges on function public.create_team_game(uuid, uuid, uuid, jsonb, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.create_team_game(uuid, uuid, uuid, jsonb, jsonb)
to service_role;

-- Dashboard projection: identity and organization boundaries are checked in the
-- database and only non-sensitive game summary fields leave this function.
create function public.list_team_games(p_user_id uuid)
returns table (
  game_id uuid,
  event_name text,
  home_name text,
  away_name text,
  created_at timestamptz,
  game_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_organization_id uuid;
  active_membership_count integer;
begin
  if not exists (
    select 1 from public.user_profiles
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select count(*), min(organization_id::text)::uuid
  into active_membership_count, active_organization_id
  from public.team_memberships
  where user_id = p_user_id and status = 'active';

  if active_membership_count <> 1 then
    raise exception 'exactly one active team required' using errcode = '42501';
  end if;

  return query
  select g.id,
    coalesce(g.config ->> 'eventName', 'Untitled game'),
    coalesce(g.config ->> 'homeName', 'Home'),
    coalesce(g.config ->> 'awayName', 'Away'),
    g.created_at,
    coalesce(gs.state ->> 'status', g.status)
  from public.games g
  left join public.game_states gs on gs.game_id = g.id
  where g.organization_id = active_organization_id
  order by g.created_at desc;
end;
$$;

revoke all privileges on function public.list_team_games(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_team_games(uuid) to service_role;

notify pgrst, 'reload schema';
