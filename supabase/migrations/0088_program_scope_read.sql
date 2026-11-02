-- Program GET authorization: one snapshot, no row locks or presence writes.
-- Receiver check/ticket actions still own heartbeat renewal and stale-peer recovery.
begin;
create or replace function public.m3_program_scope_available(
  p_game_id uuid, p_organization_id uuid,
  p_home_session_id uuid, p_away_session_id uuid
) returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.games g
    join public.game_states gs on gs.game_id=g.id
    join public.m2_studio_sessions s on s.game_id=g.id
    where g.id=p_game_id and g.organization_id=p_organization_id
      and g.deleted_at is null and g.completed_at is null
      and g.status='active' and gs.state->>'status'='active'
      and s.organization_id=g.organization_id
      and s.status='active' and s.expires_at>now()
      and ((s.camera_role='camera-home' and s.id=p_home_session_id)
        or (s.camera_role='camera-away' and s.id=p_away_session_id))
  );
$$;
-- An unexpired receiver scope can resume even after missed heartbeats (0069).
-- This read grants no channel ticket, revives no peer and extends no deadline.
revoke all on function public.m3_program_scope_available(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.m3_program_scope_available(uuid,uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
