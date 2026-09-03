-- POST /api/games has no authenticated Supabase user yet: it issues the
-- game-scoped organizer token after creation. Create its owning records through
-- a service-role-only function while satisfying the non-null organization and
-- creator contract established by 0001_initial.sql.
create or replace function public.create_game(
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
  service_organization_id constant uuid := '00000000-0000-4000-8000-000000000001';
  service_user_id constant uuid := '00000000-0000-4000-8000-000000000002';
begin
  insert into public.organizations (id, name)
  values (service_organization_id, 'CurlCast')
  on conflict (id) do nothing;

  insert into public.organizer_users (organization_id, user_id)
  values (service_organization_id, service_user_id)
  on conflict (organization_id, user_id) do nothing;

  insert into public.games (
    id,
    organization_id,
    config,
    status,
    created_by
  ) values (
    p_game_id,
    service_organization_id,
    p_config,
    'active',
    service_user_id
  );

  insert into public.game_states (game_id, state)
  values (p_game_id, p_state);
end;
$$;

revoke all on function public.create_game(uuid, jsonb, jsonb) from public;
revoke all on function public.create_game(uuid, jsonb, jsonb) from anon;
revoke all on function public.create_game(uuid, jsonb, jsonb) from authenticated;
grant execute on function public.create_game(uuid, jsonb, jsonb) to service_role;
