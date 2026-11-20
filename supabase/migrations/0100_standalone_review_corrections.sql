begin;

alter table public.shot_tracker_review_corrections
  alter column shot_id drop not null,
  add column standalone_review_id uuid references public.shot_tracker_standalone_reviews(request_id),
  add constraint shot_tracker_review_corrections_one_target
    check ((shot_id is null) <> (standalone_review_id is null));

create index standalone_review_corrections_lookup
  on public.shot_tracker_review_corrections
  (organization_id, actor_user_id, game_id, standalone_review_id, sequence desc)
  where standalone_review_id is not null;

create function public.read_standalone_review_corrections(p_actor uuid, p_org uuid, p_games uuid[])
returns table (review_id uuid, video_url text, start_seconds integer, note text)
language plpgsql security definer set search_path = '' as $$
declare requested_game uuid;
begin
  if p_games is null or cardinality(p_games) = 0 then return; end if;
  foreach requested_game in array p_games loop
    perform public.assert_curlcoach_actor(p_actor, p_org, requested_game);
  end loop;

  return query
    select distinct on (c.standalone_review_id)
      c.standalone_review_id, c.video_url, c.start_seconds, c.note
    from public.shot_tracker_review_corrections c
    join public.games g on g.id = c.game_id and g.deleted_at is null
    where c.organization_id = p_org and c.actor_user_id = p_actor
      and c.game_id = any(p_games) and c.standalone_review_id is not null
    order by c.standalone_review_id, c.sequence desc;
end;
$$;

create function public.save_standalone_review_correction(
  p_actor uuid, p_org uuid, p_game uuid, p_review uuid, p_request uuid,
  p_url text, p_start integer, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_curlcoach_actor(p_actor, p_org, p_game);
  if not exists (
    select 1 from public.shot_tracker_standalone_reviews r
    join public.games g on g.id = r.game_id and g.deleted_at is null
    where r.request_id = p_review and r.game_id = p_game
      and r.organization_id = p_org and r.actor_user_id = p_actor
  ) then
    raise exception 'standalone review unavailable' using errcode = '42501';
  end if;
  if p_url !~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid recording' using errcode = '22023';
  end if;

  insert into public.shot_tracker_review_corrections
    (request_id, organization_id, actor_user_id, game_id, standalone_review_id, video_url, start_seconds, note)
    values (p_request, p_org, p_actor, p_game, p_review, p_url, p_start, p_note)
    on conflict (request_id) do nothing;
  if not exists (
    select 1 from public.shot_tracker_review_corrections c
    where c.request_id = p_request and c.organization_id = p_org
      and c.actor_user_id = p_actor and c.game_id = p_game and c.standalone_review_id = p_review
      and c.video_url = p_url and c.start_seconds = p_start and c.note = p_note
  ) then
    raise exception 'request conflict' using errcode = '40001';
  end if;
end;
$$;

revoke all on function public.read_standalone_review_corrections(uuid, uuid, uuid[])
  from public, anon, authenticated;
revoke all on function public.save_standalone_review_correction(uuid, uuid, uuid, uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.read_standalone_review_corrections(uuid, uuid, uuid[]) to service_role;
grant execute on function public.save_standalone_review_correction(uuid, uuid, uuid, uuid, uuid, text, integer, text)
  to service_role;
notify pgrst, 'reload schema';

commit;
