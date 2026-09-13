begin;
-- Game operators can run games without receiving team administration, billing,
-- sponsor-library, or YouTube-account authority. The generic organization
-- write helper remains deliberately unchanged.
create function public.verified_game_operator(p_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_count integer;
begin
  if not exists (
    select 1 from public.user_profiles
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select count(*), min(organization_id::text)::uuid into v_count, v_org
  from public.team_memberships
  where user_id = p_user_id and status = 'active';
  if v_count = 0 then
    raise exception 'team setup required' using errcode = 'P0001';
  elsif v_count > 1 then
    raise exception 'team selection required' using errcode = 'P0002';
  end if;

  if not exists (
    select 1 from public.team_memberships
    where user_id = p_user_id and organization_id = v_org
      and status = 'active'
      and role in ('owner', 'team_admin', 'game_operator', 'scorer')
  ) then
    raise exception 'game operator membership required' using errcode = '42501';
  end if;
  return v_org;
end;
$$;

-- Replace only the final deployed game-operation functions. The exact source
-- substitution is guarded so a later definition change fails closed.
do $$
declare
  v_target regprocedure;
  v_source text;
  v_rewritten text;
begin
  foreach v_target in array array[
    'public.create_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb,jsonb)'::regprocedure,
    'public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)'::regprocedure,
    'public.claim_scheduled_youtube_broadcast(uuid,uuid)'::regprocedure,
    'public.record_scheduled_youtube_broadcast(uuid,uuid,text,text,text,text,bigint)'::regprocedure
  ] loop
    select pg_get_functiondef(v_target) into v_source;
    if position('public.verified_team_for_operation(p_user_id,true)' in v_source) > 0 then
      v_rewritten := replace(
        v_source,
        'public.verified_team_for_operation(p_user_id,true)',
        'public.verified_game_operator(p_user_id)'
      );
    elsif position('public.verified_team_for_operation(p_user_id, true)' in v_source) > 0 then
      v_rewritten := replace(
        v_source,
        'public.verified_team_for_operation(p_user_id, true)',
        'public.verified_game_operator(p_user_id)'
      );
    else
      raise exception 'expected one scoped game authorization call in %', v_target;
    end if;
    if position('verified_team_for_operation' in v_rewritten) > 0 then
      raise exception 'unexpected additional team authorization call in %', v_target;
    end if;
    execute v_rewritten;
  end loop;
end;
$$;

-- The legacy single-game endpoint remains available during the scheduling
-- rollout, so admit the same role there without changing any other RPC.
do $$
declare
  v_source text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.create_team_game(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure
  ) into v_source;
  if position('role in (''owner'', ''team_admin'', ''scorer'')' in v_source) = 0 then
    raise exception 'expected legacy game creation membership gate';
  end if;
  v_rewritten := replace(
    v_source,
    'role in (''owner'', ''team_admin'', ''scorer'')',
    'role in (''owner'', ''team_admin'', ''game_operator'', ''scorer'')'
  );
  execute v_rewritten;
end;
$$;

-- A game operator may add a currently missing opponent while scheduling, but
-- cannot restore or otherwise alter an archived record.
create or replace function public.find_or_create_opponent(
  p_user_id uuid,
  p_opponent_id uuid,
  p_display_name text
)
returns table(opponent_id uuid, display_name text, restored boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_game_operator(p_user_id);
  v_role public.team_membership_role;
  v_id uuid;
  v_name text;
  v_archived timestamptz;
begin
  select role into v_role from public.team_memberships
  where user_id = p_user_id and organization_id = v_org and status = 'active';
  select o.id, o.display_name, o.archived_at into v_id, v_name, v_archived
  from public.opponents o
  where o.organization_id = v_org
    and o.normalized_name = lower(regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'))
  for update;
  if found then
    if v_archived is not null then
      if v_role = 'game_operator'::public.team_membership_role then
        raise exception 'opponent_unavailable' using errcode = '23514';
      end if;
      update public.opponents
      set archived_at = null, display_name = btrim(p_display_name), updated_at = now()
      where id = v_id;
      insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
      values (p_user_id, v_org, 'opponent.restored', 'opponent', v_id::text, '{}'::jsonb);
    end if;
    return query select v_id, coalesce(nullif(btrim(p_display_name), ''), v_name), v_archived is not null;
    return;
  end if;
  begin
    insert into public.opponents(id, organization_id, display_name, created_by)
    values (p_opponent_id, v_org, btrim(p_display_name), p_user_id)
    returning id, opponents.display_name into v_id, v_name;
  exception when unique_violation then
    select o.id, o.display_name into v_id, v_name from public.opponents o
    where o.organization_id = v_org
      and o.normalized_name = lower(regexp_replace(btrim(p_display_name), '\s+', ' ', 'g'));
  end;
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_user_id, v_org, 'opponent.created', 'opponent', v_id::text,
    jsonb_build_object('display_name', left(v_name, 100)));
  return query select v_id, v_name, false;
end;
$$;

create or replace function public.authorize_game_broadcast_actor(
  p_game_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean
)
returns table(organization_id uuid, actor_kind text)
language plpgsql
security definer
set search_path = ''
stable
as $$
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
      and m.role in ('owner', 'team_admin', 'game_operator')
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'verified game operator required' using errcode = '42501';
  end if;
  return query select v_org, 'account'::text;
end;
$$;

-- Ending a game is a game-operation action; membership and organization are
-- independently rechecked by the completion RPCs.
do $$
declare
  v_source text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.authorize_game_completion_actor(uuid,uuid,boolean)'::regprocedure
  ) into v_source;
  if position('m.role in (''owner'', ''team_admin'')' in v_source) = 0 then
    raise exception 'expected one completion membership gate';
  end if;
  v_rewritten := replace(
    v_source,
    'm.role in (''owner'', ''team_admin'')',
    'm.role in (''owner'', ''team_admin'', ''game_operator'')'
  );
  execute v_rewritten;
end;
$$;

revoke all on function public.verified_game_operator(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.find_or_create_opponent(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.find_or_create_opponent(uuid, uuid, text)
to service_role;

notify pgrst, 'reload schema';

commit;
