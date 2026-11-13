-- Keep the event-derived review for the existing stale-score check. An
-- explicit final result changes the published totals without changing any ends.
begin;

alter table public.game_completion_reviews add column final_result jsonb;

create function public.review_game_completion_with_final_score(
  p_game_id uuid,
  p_review_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_youtube_watch_url text,
  p_selection jsonb
)
returns table (review_id uuid, input_revision bigint, result jsonb, youtube_watch_url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_revision bigint; v_result jsonb; v_actor record; v_game record; v_state_status text;
  v_totals jsonb; v_home numeric; v_away numeric; v_outcome text; v_final_result jsonb;
begin
  if not public.is_valid_youtube_watch_url(p_youtube_watch_url) then
    raise exception 'invalid_youtube_watch_url' using errcode = '22023';
  end if;
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_state_unavailable' using errcode = '55000'; end if;
  select * into v_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '42501'; end if;
  select * into v_actor from public.authorize_game_completion_actor(
    p_game_id, p_actor_user_id, p_verified_organizer);
  select gs.state->>'status' into v_state_status
    from public.game_states gs where gs.game_id = p_game_id;
  if v_game.deleted_at is not null then raise exception 'game_deleted' using errcode = '55000'; end if;
  if v_game.completed_at is not null then raise exception 'game_already_completed' using errcode = '55000'; end if;
  if v_game.status = 'closed' or v_state_status = 'closed' then
    raise exception 'historical_closed_game' using errcode = '55000';
  end if;

  select r.revision into v_revision from public.game_result_revisions r
    where r.game_id = p_game_id;
  v_result := public.derive_game_completion_result(p_game_id);

  -- SQL NULL retains the derived result; {"finalScore":null} deliberately
  -- publishes no result even if there are recorded ends.
  if p_selection is not null then
    if jsonb_typeof(p_selection) <> 'object' or not (p_selection ? 'finalScore')
      or p_selection - 'finalScore' <> '{}'::jsonb then
      raise exception 'invalid_final_score' using errcode = '22023';
    end if;
    v_totals := p_selection->'finalScore';
    if v_totals = 'null'::jsonb then
      v_outcome := 'no_result';
    else
      if jsonb_typeof(v_totals) <> 'object'
        or jsonb_typeof(v_totals->'home') is distinct from 'number'
        or jsonb_typeof(v_totals->'away') is distinct from 'number'
        or v_totals - array['home','away'] <> '{}'::jsonb then
        raise exception 'invalid_final_score' using errcode = '22023';
      end if;
      v_home := (v_totals->>'home')::numeric;
      v_away := (v_totals->>'away')::numeric;
      if v_home not between 0 and 9007199254740991 or v_home <> trunc(v_home)
        or v_away not between 0 and 9007199254740991 or v_away <> trunc(v_away) then
        raise exception 'invalid_final_score' using errcode = '22023';
      end if;
      v_outcome := case when v_home = v_away then 'tie'
        when v_home > v_away then 'home_win' else 'away_win' end;
    end if;
    v_final_result := v_result || jsonb_build_object(
      'outcome', v_outcome,
      'label', case v_outcome when 'no_result' then 'No result recorded'
        when 'tie' then 'Tie' when 'home_win' then 'Home win' else 'Away win' end,
      'totals', v_totals
    );
  end if;

  insert into public.game_completion_reviews(
    id, game_id, input_revision, result, final_result, reviewer_kind, reviewer_user_id,
    youtube_watch_url)
  values (p_review_id, p_game_id, v_revision, v_result, v_final_result, v_actor.actor_kind,
    case when v_actor.actor_kind = 'account' then p_actor_user_id else null end,
    p_youtube_watch_url);
  return query select p_review_id, v_revision, coalesce(v_final_result, v_result), p_youtube_watch_url;
end;
$$;

create or replace function public.review_game_completion_with_link(
  p_game_id uuid,
  p_review_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_youtube_watch_url text
)
returns table (review_id uuid, input_revision bigint, result jsonb, youtube_watch_url text)
language sql security definer set search_path = '' as $$
  select * from public.review_game_completion_with_final_score(
    p_game_id, p_review_id, p_actor_user_id, p_verified_organizer, p_youtube_watch_url, null);
$$;

create or replace function public.complete_reviewed_game(p_game_id uuid,
  p_review_id uuid,
  p_completion_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean
)
returns table (completion_id uuid, review_id uuid, input_revision bigint, result jsonb, completed_at timestamptz, cleanup_status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game record; v_actor record; v_review record; v_revision bigint; v_existing record;
  v_state_status text; v_result jsonb; v_completed_at timestamptz := now();
begin
  -- All multi-record lifecycle operations lock game_states first, then games.
  -- Direct state UPDATEs already hold this same row lock before their trigger.
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_state_unavailable' using errcode = '55000'; end if;
  select * into v_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '42501'; end if;
  select * into v_actor from public.authorize_game_completion_actor(p_game_id, p_actor_user_id, p_verified_organizer);

  select c.completion_id, c.review_id, c.input_revision, c.result, c.completed_at, x.status
  into v_existing from public.game_completions c
  join public.game_completion_cleanup x on x.game_id = c.game_id
  where c.game_id = p_game_id;
  if found then
    return query select v_existing.completion_id, v_existing.review_id, v_existing.input_revision,
      v_existing.result, v_existing.completed_at, v_existing.status;
    return;
  end if;

  if v_game.deleted_at is not null then raise exception 'game_deleted' using errcode = '55000'; end if;
  select gs.state->>'status' into v_state_status from public.game_states gs where gs.game_id = p_game_id;
  if v_game.status = 'closed' or v_state_status = 'closed' then
    raise exception 'historical_closed_game' using errcode = '55000';
  end if;
  select r.* into v_review from public.game_completion_reviews r
    where r.id = p_review_id and r.game_id = p_game_id;
  if not found then raise exception 'completion_review_required' using errcode = 'PT409'; end if;
  select r.revision into v_revision from public.game_result_revisions r where r.game_id = p_game_id;
  if v_revision is distinct from v_review.input_revision
     or public.derive_game_completion_result(p_game_id) is distinct from v_review.result then
    raise exception 'completion_review_conflict' using errcode = 'PT409';
  end if;
  v_result := coalesce(v_review.final_result, v_review.result);

  update public.game_states set
    state = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
      state, '{status}', '"completed"'::jsonb, true),
      '{claims}', '{}'::jsonb, true),
      '{connections}', '{"camera-home":false,"camera-away":false,"scorer":false}'::jsonb, true),
      '{cameraHealth}', '{}'::jsonb, true),
      '{broadcast}', '"idle"'::jsonb, true),
      '{audioMuted}', 'true'::jsonb, true),
      '{sponsorMode}', coalesce(state->'sponsorMode', '{}'::jsonb) ||
        '{"active":false,"paused":false,"startedAt":null,"mutedPrevious":false}'::jsonb, true),
    version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint),
    updated_at = v_completed_at
  where game_id = p_game_id;
  if not found then raise exception 'game_state_unavailable' using errcode = '55000'; end if;

  update public.games set status = 'completed', completed_at = v_completed_at,
    completion_id = p_completion_id where id = p_game_id;
  insert into public.game_completions(game_id, completion_id, organization_id, review_id,
    input_revision, result, result_context, completed_by_kind, completed_by_user_id, completed_at)
  values (p_game_id, p_completion_id, v_game.organization_id, p_review_id,
    v_review.input_revision, v_result,
    jsonb_build_object('eventName', v_game.config->>'eventName',
      'homeName', v_game.config->>'homeName', 'awayName', v_game.config->>'awayName',
      'scheduledEnds', v_game.config->'scheduledEnds', 'seasonId', v_game.season_id,
      'eventId', v_game.event_id, 'opponentId', v_game.opponent_id,
      'scheduledStart', v_game.scheduled_start, 'gameNumber', v_game.game_number),
    v_actor.actor_kind, case when v_actor.actor_kind = 'account' then p_actor_user_id else null end,
    v_completed_at);
  insert into public.game_completion_cleanup(game_id, provider, status, requested_at)
    values (p_game_id, 'livekit', 'pending', v_completed_at);
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (case when v_actor.actor_kind = 'account' then p_actor_user_id else null end,
    v_game.organization_id, 'game.completed', 'game', p_game_id::text,
    jsonb_build_object('completion_id', p_completion_id, 'review_id', p_review_id,
      'input_revision', v_review.input_revision, 'outcome', v_result->>'outcome'));
  return query select p_completion_id, p_review_id, v_review.input_revision,
    v_result, v_completed_at, 'pending'::text;
end;
$$;

revoke all on function public.review_game_completion_with_final_score(uuid,uuid,uuid,boolean,text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function public.review_game_completion_with_final_score(uuid,uuid,uuid,boolean,text,jsonb)
  to service_role;

notify pgrst, 'reload schema';
commit;
