-- Schedule data belongs to the canonical games row, not mutable JSON state.
-- Return it with the existing service-only lifecycle snapshot so every game
-- projection can use the same consistent read without a second query.
begin;

drop function public.read_game_state(uuid);

create function public.read_game_state(p_game_id uuid)
returns table (
  outcome text,
  state jsonb,
  scheduled_start timestamptz,
  schedule_timezone text
)
language sql stable security definer set search_path = ''
as $$
  select
    case
      when g.deleted_at is not null then 'deleted'
      when g.completed_at is not null or g.status = 'closed'
        or gs.state->>'status' in ('closed', 'completed') then 'closed'
      when gs.state is null or gs.state->>'status' is distinct from 'active'
        then 'unavailable'
      else 'active'
    end,
    case
      when g.deleted_at is null and g.completed_at is null and g.status <> 'closed'
        and gs.state->>'status' = 'active' then gs.state
      else null
    end,
    g.scheduled_start,
    g.schedule_timezone
  from public.games g
  left join public.game_states gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;

revoke all privileges on function public.read_game_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.read_game_state(uuid) to service_role;
notify pgrst, 'reload schema';

commit;
