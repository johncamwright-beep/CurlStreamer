begin;

alter table public.shot_tracker_standalone_reviews
  add column end_number integer,
  add column shot_number integer,
  add constraint standalone_review_shot_context_check check (
    (end_number is null and shot_number is null)
    or (audience = 'team' and end_number is not null and shot_number is not null
      and end_number between 1 and 20 and shot_number between 1 and 8)
  );

create function public.save_standalone_review(
  p_actor uuid, p_org uuid, p_game uuid, p_request uuid,
  p_audience text, p_player text, p_name text, p_note text, p_selected timestamptz,
  p_end integer, p_shot integer
) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.assert_curlcoach_actor(p_actor, p_org, p_game);
  if exists(select 1 from public.games where id = p_game and deleted_at is not null) then
    raise exception 'game unavailable' using errcode = '42501';
  end if;
  insert into public.shot_tracker_standalone_reviews (
    request_id, organization_id, actor_user_id, game_id, audience,
    player_id, player_name, note, selected_at, end_number, shot_number
  ) values (
    p_request, p_org, p_actor, p_game, p_audience,
    p_player, p_name, p_note, p_selected, p_end, p_shot
  ) on conflict (request_id) do nothing;

  if not exists (
    select 1 from public.shot_tracker_standalone_reviews
    where request_id = p_request and organization_id = p_org and actor_user_id = p_actor
      and game_id = p_game and audience = p_audience
      and player_id is not distinct from p_player and player_name is not distinct from p_name
      and note = p_note and selected_at = p_selected
      and end_number is not distinct from p_end and shot_number is not distinct from p_shot
  ) then
    raise exception 'request conflict' using errcode = '40001';
  end if;
end;
$$;

-- Keep the existing RPC signature for older clients and context-free flags.
create or replace function public.save_standalone_review(
  p_actor uuid, p_org uuid, p_game uuid, p_request uuid,
  p_audience text, p_player text, p_name text, p_note text, p_selected timestamptz
) returns void language sql security definer set search_path = '' as $$
  select public.save_standalone_review(
    p_actor, p_org, p_game, p_request, p_audience, p_player, p_name, p_note, p_selected,
    null::integer, null::integer
  );
$$;

revoke all on function public.save_standalone_review(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, integer, integer)
  from public, anon, authenticated;
grant execute on function public.save_standalone_review(uuid, uuid, uuid, uuid, text, text, text, text, timestamptz, integer, integer)
  to service_role;

notify pgrst, 'reload schema';

commit;
