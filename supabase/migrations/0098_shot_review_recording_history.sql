begin;

-- Expose only review metadata from the current session and provider-retired cycles.
create function public.read_shot_tracker_recording_history(p_actor uuid, p_org uuid, p_games uuid[])
returns table (
  game_id uuid, youtube_broadcast_id text, started_at timestamptz,
  stopped_at timestamptz, is_current boolean
)
language plpgsql security definer set search_path = '' as $$
declare requested_game uuid;
begin
  if p_games is null or cardinality(p_games) = 0 then return; end if;
  foreach requested_game in array p_games loop
    perform public.assert_curlcoach_actor(p_actor, p_org, requested_game);
  end loop;

  return query
    with selected_games as (
      select g.id from public.games g
      where g.organization_id = p_org and g.id = any(p_games) and g.deleted_at is null
    )
    select b.game_id, b.youtube_broadcast_id, b.started_at, b.stopped_at, true
    from public.broadcast_sessions b join selected_games g on g.id = b.game_id
    where b.organization_id = p_org and b.provider = 'youtube'
      and b.youtube_broadcast_id is not null
    union all
    select h.game_id, r.youtube_broadcast_id, (h.metadata->>'started_at')::timestamptz,
      coalesce((h.metadata->>'stopped_at')::timestamptz, r.confirmed_at), false
    from public.m4_broadcast_cycle_history h
    join selected_games g on g.id = h.game_id
    join public.m4_provider_retirements r on r.retirement_id = h.retirement_id
      and r.game_id = h.game_id and r.organization_id = h.organization_id
      and r.youtube_broadcast_id = h.metadata->>'youtube_broadcast_id'
    where h.organization_id = p_org and h.metadata->>'provider' = 'youtube';
end;
$$;

revoke all on function public.read_shot_tracker_recording_history(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_shot_tracker_recording_history(uuid,uuid,uuid[]) to service_role;
notify pgrst, 'reload schema';

commit;
