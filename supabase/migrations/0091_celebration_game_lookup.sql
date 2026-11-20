-- Keep the existing games table inaccessible to API roles.
-- Server routes must authorize the game before resolving its celebration team.
begin;
create function public.read_celebration_game_organization(p_game_id uuid)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select g.organization_id
  from public.games g
  join public.game_states gs on gs.game_id = g.id
  where g.id = p_game_id
    and g.deleted_at is null
    and g.completed_at is null
    and g.status not in ('closed', 'completed')
    and gs.state->>'status' = 'active';
$$;
revoke all on function public.read_celebration_game_organization(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_celebration_game_organization(uuid) to service_role;
notify pgrst, 'reload schema';
commit;
