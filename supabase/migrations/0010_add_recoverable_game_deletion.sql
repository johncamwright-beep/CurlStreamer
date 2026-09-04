-- Recoverable deletion follows the hierarchy migration. No related record is
-- removed, so restoring a game preserves its schedule, access, and history.
alter table public.games
  add column deleted_at timestamptz,
  add column deleted_by_user_id uuid references auth.users(id) on delete set null;

create index games_organization_active_created_idx
  on public.games (organization_id, created_at desc, id) where deleted_at is null;
create index games_organization_deleted_at_idx
  on public.games (organization_id, deleted_at desc, id) where deleted_at is not null;

create or replace function public.list_team_games(p_user_id uuid)
returns table (game_id uuid,event_name text,home_name text,away_name text,created_at timestamptz,game_status text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin return query
  select g.id,coalesce(g.config->>'eventName','Untitled game'),coalesce(g.config->>'homeName','Home'),
    coalesce(g.config->>'awayName','Away'),g.created_at,coalesce(gs.state->>'status',g.status)
  from public.games g left join public.game_states gs on gs.game_id=g.id
  where g.organization_id=v_org and g.deleted_at is null order by g.created_at desc,g.id;
end $$;

create function public.list_deleted_team_games(p_user_id uuid)
returns table (game_id uuid,event_name text,home_name text,away_name text,created_at timestamptz,game_status text,deleted_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  if not exists(select 1 from public.team_memberships where user_id=p_user_id and organization_id=v_org
    and status='active' and role in ('owner','team_admin')) then
    raise exception 'team administrator required' using errcode='42501';
  end if;
  return query select g.id,coalesce(g.config->>'eventName','Untitled game'),coalesce(g.config->>'homeName','Home'),
    coalesce(g.config->>'awayName','Away'),g.created_at,coalesce(gs.state->>'status',g.status),g.deleted_at
  from public.games g left join public.game_states gs on gs.game_id=g.id
  where g.organization_id=v_org and g.deleted_at is not null order by g.deleted_at desc,g.id;
end $$;

create function public.soft_delete_team_game(p_user_id uuid,p_game_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false); v_changed boolean;
begin
  if not exists(select 1 from public.team_memberships where user_id=p_user_id and organization_id=v_org
    and status='active' and role in ('owner','team_admin')) then raise exception 'team administrator required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,10));
  if exists(select 1 from public.game_states gs join public.games g on g.id=gs.game_id
    where g.id=p_game_id and g.organization_id=v_org and g.deleted_at is null and gs.state->>'broadcast'='live')
    then raise exception 'stop the live session before deleting this game' using errcode='55000'; end if;
  update public.games set deleted_at=now(),deleted_by_user_id=p_user_id
    where id=p_game_id and organization_id=v_org and deleted_at is null;
  v_changed := found;
  if v_changed then insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,'game.deleted','game',p_game_id::text,jsonb_build_object('source','team_dashboard')); end if;
  return v_changed;
end $$;

create function public.restore_team_game(p_user_id uuid,p_game_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false); v_changed boolean;
begin
  if not exists(select 1 from public.team_memberships where user_id=p_user_id and organization_id=v_org
    and status='active' and role in ('owner','team_admin')) then raise exception 'team administrator required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,10));
  update public.games set deleted_at=null,deleted_by_user_id=null
    where id=p_game_id and organization_id=v_org and deleted_at is not null;
  v_changed := found;
  if v_changed then insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,'game.restored','game',p_game_id::text,jsonb_build_object('source','team_dashboard')); end if;
  return v_changed;
end $$;

revoke all privileges on function public.list_deleted_team_games(uuid),public.soft_delete_team_game(uuid,uuid),public.restore_team_game(uuid,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.list_deleted_team_games(uuid),public.soft_delete_team_game(uuid,uuid),public.restore_team_game(uuid,uuid) to service_role;
notify pgrst, 'reload schema';
