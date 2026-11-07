-- Application conflicts are final for these input revisions. SQLSTATE 40001
-- makes affected PostgREST versions retry the same stale input indefinitely.
-- PT409 returns HTTP 409 once. Preserve all locks, revision checks, authority
-- checks, ownership and existing grants through CREATE OR REPLACE.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b

create or replace function public.append_score_event(
  p_game_id uuid, p_expected_version bigint, p_event_id uuid, p_event_type text,
  p_payload jsonb, p_actor text, p_state jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_completed boolean; v_game_completed_at timestamptz;
begin
  select gs.state->>'status' = 'completed' into v_completed
  from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  if v_completed then raise exception 'completed_game_terminal' using errcode = '55000'; end if;
  select g.completed_at into v_game_completed_at
  from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  if v_game_completed_at is not null then
    raise exception 'completed_game_terminal' using errcode = '55000';
  end if;
  update public.game_states set state = p_state,
    version = greatest(version + 1, (extract(epoch from clock_timestamp()) * 1000)::bigint), updated_at = now()
  where game_id = p_game_id and version = p_expected_version;
  if not found then raise exception 'stale game state for %', p_game_id using errcode = 'PT409'; end if;
  insert into public.score_events(id, game_id, event_type, payload, actor)
  values (p_event_id, p_game_id, p_event_type, p_payload, p_actor);
end;
$$;

create or replace function public.complete_reviewed_game(
  p_game_id uuid,
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
  v_state_status text; v_completed_at timestamptz := now();
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
    v_review.input_revision, v_review.result,
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
      'input_revision', v_review.input_revision, 'outcome', v_review.result->>'outcome'));
  return query select p_completion_id, p_review_id, v_review.input_revision,
    v_review.result, v_completed_at, 'pending'::text;
end;
$$;

create or replace function public.write_game_state(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
  v_current jsonb;
  v_next jsonb := p_state;
  v_generations jsonb;
  v_role text;
  v_old_claim text;
  v_new_claim text;
  v_generation bigint;
begin
  select gs.state into v_current
  from public.game_states gs
  where gs.game_id = p_game_id and gs.version = p_expected_version
  for update;
  if not found then
    if not exists (select 1 from public.game_states gs where gs.game_id = p_game_id) then
      raise exception 'game_unavailable' using errcode = '23503';
    end if;
    raise exception 'stale game state for %', p_game_id using errcode = 'PT409';
  end if;

  v_generations := coalesce(v_current->'claimGenerations', '{}'::jsonb);
  foreach v_role in array array['camera-home', 'camera-away', 'scorer'] loop
    v_old_claim := nullif(v_current#>>array['claims', v_role], '');
    v_new_claim := nullif(v_next#>>array['claims', v_role], '');
    v_generation := coalesce((v_generations->>v_role)::bigint, 0);
    if v_old_claim is null and v_new_claim is not null and v_generation <> 0 then
      raise exception 'claim_generation_required' using errcode = '55000';
    elsif v_old_claim is not null and v_new_claim is null then
      v_generations := jsonb_set(
        v_generations, array[v_role], to_jsonb(v_generation + 1), true
      );
      update public.game_invitations i set revoked_at = now()
      where i.game_id = p_game_id
        and i.role::text = replace(v_role, '-', '_')
        and i.revoked_at is null and i.consumed_at is null;
    elsif v_old_claim is distinct from v_new_claim
       and v_old_claim is not null and v_new_claim is not null then
      raise exception 'assignment_changed' using errcode = '55000';
    end if;
  end loop;
  v_next := jsonb_set(v_next, '{claimGenerations}', v_generations, true);

  update public.game_states gs
  set state = v_next,
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id
  returning gs.version into v_version;
  return v_version;
end;
$$;

create or replace function public.release_game_role(
  p_game_id uuid,
  p_role text,
  p_expected_claim text,
  p_expected_generation bigint
)
returns table(game_state jsonb, released boolean, released_generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_claim text;
  v_generation bigint;
  v_db_role public.game_role;
begin
  if p_role not in ('camera-home', 'camera-away') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  v_db_role := replace(p_role, '-', '_')::public.game_role;
  select gs.state into v_state
  from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  perform 1 from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;

  v_claim := nullif(v_state#>>array['claims', p_role::text], '');
  v_generation := coalesce(
    (v_state#>>array['claimGenerations', p_role::text])::bigint,
    0
  );
  if v_claim is null then
    return query select v_state, false, v_generation;
    return;
  end if;
  if p_expected_generation is null
     or v_claim <> p_expected_claim
     or v_generation <> p_expected_generation then
    raise exception 'assignment_changed' using errcode = 'PT409';
  end if;

  v_state := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            v_state,
            '{claimGenerations}',
            coalesce(v_state->'claimGenerations', '{}'::jsonb),
            true
          ),
          array['claims', p_role::text],
          'null'::jsonb,
          true
        ),
        array['connections', p_role::text], 'false'::jsonb, true
      ),
      array['cameraHealth', p_role::text], 'null'::jsonb, true
    ),
    array['claimGenerations', p_role::text],
    to_jsonb(v_generation + 1),
    true
  );
  v_state := v_state #- array['claims', p_role::text]
    #- array['cameraHealth', p_role::text];
  update public.game_states gs
  set state = v_state,
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id;
  update public.game_invitations i
  set revoked_at = now()
  where i.game_id = p_game_id and i.role = v_db_role
    and i.revoked_at is null and i.consumed_at is null;
  return query select v_state, true, v_generation;
end;
$$;

create or replace function public.complete_youtube_connection(
  p_user_id uuid,
  p_expected_organization_id uuid,
  p_expected_version bigint,
  p_encrypted_credentials text,
  p_channel_id text,
  p_channel_title text
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true); v_version bigint;
begin
  if v_org <> p_expected_organization_id then
    raise exception 'youtube organization changed' using errcode = 'PT409';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':youtube', 20));
  select b.connection_version into v_version from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube' for update;
  if not found then
    if p_expected_version <> 0 then raise exception 'youtube connection changed' using errcode = 'PT409'; end if;
    insert into public.broadcast_settings(
      organization_id, provider, encrypted_credentials, channel_id, channel_title,
      connection_status, connection_version, connected_by, connected_at, tested_at, updated_at
    ) values (
      v_org, 'youtube', decode(p_encrypted_credentials, 'base64'),
      p_channel_id, p_channel_title, 'connected', 1, p_user_id, now(), now(), now()
    ) returning connection_version into v_version;
  else
    if v_version <> p_expected_version then raise exception 'youtube connection changed' using errcode = 'PT409'; end if;
    update public.broadcast_settings set
      encrypted_credentials = decode(p_encrypted_credentials, 'base64'),
      channel_id = p_channel_id,
      channel_title = p_channel_title,
      connection_status = 'connected',
      connection_version = connection_version + 1,
      connected_by = p_user_id,
      connected_at = now(), tested_at = now(), last_error_code = null,
      updated_at = now()
    where organization_id = v_org and provider = 'youtube'
    returning connection_version into v_version;
  end if;
  insert into public.audit_events(
    actor_user_id, organization_id, action, subject_type, subject_identifier, metadata
  ) values (
    p_user_id, v_org, 'youtube.connected', 'organization', v_org::text,
    jsonb_build_object('channel_id', p_channel_id, 'connection_version', v_version)
  );
  return v_version;
end $$;

create or replace function public.finish_youtube_connection_test(
  p_user_id uuid, p_expected_organization_id uuid, p_expected_version bigint,
  p_ok boolean, p_error_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.youtube_team(p_user_id, true);
begin
  if v_org <> p_expected_organization_id then
    raise exception 'youtube organization changed' using errcode = 'PT409';
  end if;
  update public.broadcast_settings set
    tested_at = now(),
    connection_status = case
      when p_ok then 'connected'
      when p_error_code in ('reconnect_required', 'channel_mismatch') then 'reconnect_required'
      else connection_status
    end,
    last_error_code = case when p_ok then null else coalesce(p_error_code, 'reconnect_required') end,
    updated_at = now()
  where organization_id = v_org and provider = 'youtube'
    and connection_version = p_expected_version
    and encrypted_credentials is not null;
  if not found then raise exception 'youtube connection changed' using errcode = 'PT409'; end if;
end $$;

notify pgrst, 'reload schema';
