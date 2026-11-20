begin;
-- Keep private broadcast tables closed. Expose only authorized review metadata.
create function public.read_shot_tracker_recordings(p_actor uuid, p_org uuid, p_games uuid[])
returns table(game_id uuid, youtube_broadcast_id text, started_at timestamptz, stopped_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare requested_game uuid;
begin
  if p_games is null or cardinality(p_games)=0 then return; end if;
  foreach requested_game in array p_games loop
    perform public.assert_curlcoach_actor(p_actor,p_org,requested_game);
  end loop;
  return query select b.game_id,b.youtube_broadcast_id,b.started_at,b.stopped_at
    from public.broadcast_sessions b join public.games g on g.id=b.game_id
    where b.organization_id=p_org and g.organization_id=p_org
      and b.game_id=any(p_games) and g.deleted_at is null and b.provider='youtube';
end;
$$;
revoke all on function public.read_shot_tracker_recordings(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_shot_tracker_recordings(uuid,uuid,uuid[]) to service_role;
commit;
