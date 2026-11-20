begin;

create function public.authorize_coach_clip_relay(
  p_game_id uuid,
  p_role text,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_organization_id uuid
) returns void
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  select g.organization_id into v_org
  from public.games g join public.game_states s on s.game_id = g.id
  where g.id = p_game_id and g.deleted_at is null and g.completed_at is null
    and g.status = 'active' and s.state->>'status' = 'active';
  if v_org is null then
    raise exception 'clip relay authority required' using errcode = '42501';
  end if;

  if p_role = 'coach' and p_verified_organizer is false
    and p_actor_user_id is not null and p_organization_id = v_org then
    perform public.assert_curlcoach_actor(p_actor_user_id, v_org, p_game_id);
  elsif p_role = 'studio' and p_organization_id is null
    and ((p_actor_user_id is null and p_verified_organizer is true)
      or (p_actor_user_id is not null and p_verified_organizer is false)) then
    perform 1 from public.authorize_game_broadcast_actor(
      p_game_id, p_actor_user_id, p_verified_organizer);
    if public.effective_curlcoach_seats(v_org) <= 0 then
      raise exception 'Shot Tracker access required' using errcode = 'P0402';
    end if;
  else
    raise exception 'clip relay authority required' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.authorize_coach_clip_relay(uuid, text, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_coach_clip_relay(uuid, text, uuid, boolean, uuid)
  to service_role;
notify pgrst, 'reload schema';
commit;
