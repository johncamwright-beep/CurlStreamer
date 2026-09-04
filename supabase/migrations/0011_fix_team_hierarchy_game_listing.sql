-- Expose the scheduling fields needed by authenticated hierarchy screens
-- without weakening the deny-by-default table grants established in 0004.
create function public.list_team_hierarchy_games(p_user_id uuid)
returns table(
  id uuid,
  season_id uuid,
  event_id uuid,
  opponent_id uuid,
  scheduled_start timestamptz,
  game_number integer,
  game_label text,
  created_at timestamptz,
  game_status text,
  config jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  return query
  select
    g.id,
    g.season_id,
    g.event_id,
    g.opponent_id,
    g.scheduled_start,
    g.game_number,
    g.game_label,
    g.created_at,
    coalesce(gs.state->>'status', g.status),
    g.config
  from public.games g
  left join public.game_states gs on gs.game_id = g.id
  where g.organization_id = v_org
    and g.deleted_at is null
  order by g.scheduled_start asc nulls last, g.created_at desc, g.id;
end
$$;

revoke all privileges on function public.list_team_hierarchy_games(uuid)
from public, anon, authenticated, service_role;
grant execute on function public.list_team_hierarchy_games(uuid) to service_role;

notify pgrst, 'reload schema';
