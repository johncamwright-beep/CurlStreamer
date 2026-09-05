-- Ordinary whole-state application writers use the same opaque version token
-- as append_score_event. The UPDATE acquires game_states first; the existing
-- terminal trigger remains the database-enforced completion boundary.
create function public.write_game_state(
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
begin
  update public.game_states gs
  set state = p_state,
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id
    and gs.version = p_expected_version
  returning gs.version into v_version;

  if not found then
    if not exists (
      select 1 from public.game_states gs where gs.game_id = p_game_id
    ) then
      raise exception 'game_unavailable' using errcode = '23503';
    end if;
    raise exception 'stale game state for %', p_game_id using errcode = '40001';
  end if;

  return v_version;
end;
$$;

-- New callers provide the application-computed config snapshot. Schedule and
-- both config representations are committed together while preserving score
-- and other unrelated state fields.
create function public.update_scheduled_team_game(
  p_user_id uuid,
  p_game_id uuid,
  p_season_id uuid,
  p_event_id uuid,
  p_opponent_id uuid,
  p_scheduled_start timestamptz,
  p_timezone text,
  p_game_number integer,
  p_game_label text,
  p_config_snapshot jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, true);
  v_old_opponent uuid;
  v_old_config jsonb;
  v_new_config jsonb;
  v_away text;
  v_event_name text;
begin
  perform 1 from public.game_states where game_id = p_game_id for update;
  if not found then
    raise exception 'game_unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_game_id::text, 9));

  if p_scheduled_start is null
     or (p_event_id is not null and (p_game_number is null or p_game_number <= 0))
     or (p_event_id is null and p_game_number is not null) then
    raise exception 'invalid_schedule' using errcode = '22023';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_timezone_names where name = p_timezone
  ) then
    raise exception 'invalid_timezone' using errcode = '22023';
  end if;
  if p_config_snapshot is not null
     and jsonb_typeof(p_config_snapshot) is distinct from 'object' then
    raise exception 'invalid_config_snapshot' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.seasons
    where id = p_season_id and organization_id = v_org and status <> 'archived'
  ) then
    raise exception 'season_unavailable' using errcode = '23514';
  end if;
  if p_event_id is not null and not exists (
    select 1 from public.events
    where id = p_event_id and season_id = p_season_id
      and organization_id = v_org and archived_at is null
  ) then
    raise exception 'event_unavailable' using errcode = '23514';
  end if;
  if p_event_id is not null then
    select name into v_event_name from public.events where id = p_event_id;
  end if;
  if p_opponent_id is not null then
    select display_name into v_away from public.opponents
    where id = p_opponent_id and organization_id = v_org and archived_at is null;
    if not found then
      raise exception 'opponent_unavailable' using errcode = '23514';
    end if;
  else
    v_away := 'Opponent TBD';
  end if;

  v_event_name := coalesce(
    nullif(btrim(p_game_label), ''),
    case
      when p_event_id is null then v_away || ' — ' || p_scheduled_start::date
      else v_event_name || ' — Game ' || p_game_number
    end
  );
  select opponent_id, config into v_old_opponent, v_old_config
  from public.games
  where id = p_game_id and organization_id = v_org and deleted_at is null
  for update;
  if not found then
    raise exception 'game_unavailable' using errcode = '42501';
  end if;
  if v_old_opponent is distinct from p_opponent_id and exists (
    select 1 from public.score_events
    where game_id = p_game_id and event_type = 'end'
  ) then
    raise exception 'participant_locked' using errcode = '23514';
  end if;

  if p_config_snapshot is null then
    v_new_config := jsonb_set(
      jsonb_set(v_old_config, '{awayName}', to_jsonb(v_away), true),
      '{eventName}', to_jsonb(v_event_name), true
    );
  else
    -- The server snapshot has already applied the product rule: preserve the
    -- displayed name when its ID is unchanged, and adopt the selected library
    -- name only when the ID changes.
    v_new_config := p_config_snapshot;
  end if;

  update public.games
  set season_id = p_season_id,
      event_id = p_event_id,
      opponent_id = p_opponent_id,
      scheduled_start = p_scheduled_start,
      schedule_timezone = p_timezone,
      game_number = p_game_number,
      game_label = nullif(btrim(p_game_label), ''),
      config = v_new_config
  where id = p_game_id;
  update public.game_states
  set state = case
        when p_config_snapshot is null then
          jsonb_set(
            jsonb_set(state, '{config,awayName}', to_jsonb(v_away), true),
            '{config,eventName}', to_jsonb(v_event_name), true
          )
        else jsonb_set(state, '{config}', v_new_config, true)
      end,
      version = greatest(
        version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where game_id = p_game_id;

  insert into public.audit_events(
    actor_user_id, organization_id, action, subject_type, subject_identifier, metadata
  )
  values (
    p_user_id, v_org, 'game.schedule_updated', 'game', p_game_id::text,
    jsonb_build_object(
      'season_id', p_season_id,
      'event_id', p_event_id,
      'scheduled_start', p_scheduled_start,
      'game_number', p_game_number
    )
  );
  if v_old_opponent is null and p_opponent_id is not null then
    insert into public.audit_events(
      actor_user_id, organization_id, action, subject_type, subject_identifier, metadata
    )
    values (
      p_user_id, v_org, 'game.opponent_assigned', 'game', p_game_id::text,
      jsonb_build_object('opponent_id', p_opponent_id)
    );
  end if;
end;
$$;

-- Preserve the deployed signature for migration-first rollout. Older
-- application instances receive the same locking and version guarantees while
-- retaining their existing partial-config behavior.
create or replace function public.update_scheduled_team_game(
  p_user_id uuid,
  p_game_id uuid,
  p_season_id uuid,
  p_event_id uuid,
  p_opponent_id uuid,
  p_scheduled_start timestamptz,
  p_timezone text,
  p_game_number integer,
  p_game_label text
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.update_scheduled_team_game(
    p_user_id,
    p_game_id,
    p_season_id,
    p_event_id,
    p_opponent_id,
    p_scheduled_start,
    p_timezone,
    p_game_number,
    p_game_label,
    null::jsonb
  );
$$;

revoke all privileges on function
  public.write_game_state(uuid, bigint, jsonb),
  public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.write_game_state(uuid, bigint, jsonb),
  public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)
to service_role;

notify pgrst, 'reload schema';
