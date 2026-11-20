create function public.review_game_completion_with_scoreboard(
  p_game_id uuid,
  p_review_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_youtube_watch_url text
)
returns table (review_id uuid, input_revision bigint, result jsonb, youtube_watch_url text)
language plpgsql security definer set search_path = '' as $$
declare v_selection jsonb;
begin
  -- Keep the scoreboard snapshot and the stored review in the same lock scope.
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  perform 1 from public.games g where g.id = p_game_id for update;
  perform 1 from public.authorize_game_completion_actor(p_game_id, p_actor_user_id, p_verified_organizer);
  if public.derive_game_completion_result(p_game_id)->>'outcome' = 'no_result' then
    v_selection := '{"finalScore":{"home":0,"away":0}}'::jsonb;
  end if;
  return query select * from public.review_game_completion_with_final_score(
    p_game_id, p_review_id, p_actor_user_id, p_verified_organizer, p_youtube_watch_url, v_selection);
end;
$$;

revoke all on function public.review_game_completion_with_scoreboard(uuid,uuid,uuid,boolean,text)
  from public,anon,authenticated,service_role;
grant execute on function public.review_game_completion_with_scoreboard(uuid,uuid,uuid,boolean,text)
  to service_role;

notify pgrst, 'reload schema';
