-- Internal completion foundation. No browser role can call these routines or
-- read these records; a later migration may expose a deliberately designed API.

create sequence public.game_result_revision_seq as bigint;

create table public.game_result_revisions (
  game_id uuid primary key references public.games(id) on delete cascade,
  revision bigint not null default nextval('public.game_result_revision_seq'),
  updated_at timestamptz not null default now()
);

insert into public.game_result_revisions(game_id)
select g.id from public.games g;

create table public.game_completion_reviews (
  id uuid primary key,
  game_id uuid not null references public.games(id) on delete restrict,
  input_revision bigint not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  reviewer_kind text not null check (reviewer_kind in ('account', 'organizer')),
  reviewer_user_id uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz not null default now(),
  unique (game_id, id)
);

create index game_completion_reviews_game_revision_idx
  on public.game_completion_reviews(game_id, input_revision, reviewed_at desc);

create table public.game_completions (
  game_id uuid primary key references public.games(id) on delete restrict,
  completion_id uuid not null unique,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  review_id uuid not null unique references public.game_completion_reviews(id) on delete restrict,
  input_revision bigint not null,
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  result_context jsonb not null check (jsonb_typeof(result_context) = 'object'),
  completed_by_kind text not null check (completed_by_kind in ('account', 'organizer')),
  completed_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz not null default now()
);

-- Provider cleanup is intentionally separate from the immutable result. A
-- pending row means only that teardown still needs proof; it never claims that
-- a LiveKit room or participant was stopped.
create table public.game_completion_cleanup (
  game_id uuid primary key references public.game_completions(game_id) on delete restrict,
  provider text not null check (provider = 'livekit'),
  status text not null default 'pending' check (status in ('pending', 'complete')),
  attempts integer not null default 0 check (attempts >= 0),
  requested_at timestamptz not null default now(),
  last_attempted_at timestamptz,
  completed_at timestamptz,
  check ((status = 'complete') = (completed_at is not null))
);

alter table public.games add column completed_at timestamptz;
alter table public.games add column completion_id uuid;
alter table public.games add constraint games_completion_columns_together
  check ((completed_at is null) = (completion_id is null));
alter table public.games add constraint games_completed_status
  check (completed_at is null or status = 'completed');
alter table public.games add constraint games_completion_id_unique unique (completion_id);

alter table public.game_result_revisions enable row level security;
alter table public.game_completion_reviews enable row level security;
alter table public.game_completions enable row level security;
alter table public.game_completion_cleanup enable row level security;

revoke all privileges on table
  public.game_result_revisions,
  public.game_completion_reviews,
  public.game_completions,
  public.game_completion_cleanup
from public, anon, authenticated, service_role;
revoke all privileges on sequence public.game_result_revision_seq
from public, anon, authenticated, service_role;

create function public.bump_game_result_revision(p_game_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.game_result_revisions(game_id, revision, updated_at)
  values (p_game_id, nextval('public.game_result_revision_seq'), now())
  on conflict (game_id) do update
    set revision = excluded.revision, updated_at = excluded.updated_at;
end;
$$;

create function public.guard_game_row_after_completion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.completed_at is not null then
      raise exception 'completed_game_terminal' using errcode = '55000';
    end if;
    return old;
  end if;

  if old.completed_at is not null and
     (to_jsonb(new) - array['deleted_at', 'deleted_by_user_id']) is distinct from
     (to_jsonb(old) - array['deleted_at', 'deleted_by_user_id']) then
    raise exception 'completed_game_terminal' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function public.track_game_result_input_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.config is distinct from new.config
     or old.season_id is distinct from new.season_id
     or old.event_id is distinct from new.event_id
     or old.opponent_id is distinct from new.opponent_id
     or old.scheduled_start is distinct from new.scheduled_start
     or old.schedule_timezone is distinct from new.schedule_timezone
     or old.game_number is distinct from new.game_number
     or old.game_label is distinct from new.game_label then
    perform public.bump_game_result_revision(new.id);
  end if;
  return null;
end;
$$;

create function public.guard_game_state_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  v_completed_at timestamptz;
begin
  -- PostgreSQL has already locked the target game_states row before this ROW
  -- trigger runs. Do not acquire the parent row here: completion and scoring
  -- deliberately use this state row as their first lifecycle lock.
  if tg_op <> 'INSERT' and old.state->>'status' = 'completed' then
    raise exception 'completed_game_terminal' using errcode = '55000';
  end if;
  select g.completed_at into v_completed_at
  from public.games g where g.id = v_game_id;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  if v_completed_at is not null then
    raise exception 'completed_game_terminal' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.track_game_state_result_input_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or old.state->'config' is distinct from new.state->'config'
     or old.state->'scoreEvents' is distinct from new.state->'scoreEvents' then
    perform public.bump_game_result_revision(new.game_id);
  end if;
  return null;
end;
$$;

create function public.guard_score_event_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game_id uuid := case when tg_op = 'DELETE' then old.game_id else new.game_id end;
  v_completed_at timestamptz;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'score_events_append_only' using errcode = '55000';
  end if;
  select g.completed_at into v_completed_at
  from public.games g where g.id = v_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  if v_completed_at is not null then
    raise exception 'completed_game_terminal' using errcode = '55000';
  end if;
  return new;
end;
$$;

create function public.track_score_event_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.bump_game_result_revision(new.game_id);
  return null;
end;
$$;

create trigger guard_game_row_after_completion
before update or delete on public.games
for each row execute function public.guard_game_row_after_completion();
create trigger track_game_result_input_change
after update on public.games
for each row execute function public.track_game_result_input_change();
create trigger guard_game_state_write
before insert or update or delete on public.game_states
for each row execute function public.guard_game_state_write();
create trigger track_game_state_result_input_change
after insert or update on public.game_states
for each row execute function public.track_game_state_result_input_change();
create trigger guard_score_event_write
before insert or update or delete on public.score_events
for each row execute function public.guard_score_event_write();
create trigger track_score_event_insert
after insert on public.score_events
for each row execute function public.track_score_event_insert();

-- The existing audit FK declares ON DELETE SET NULL, so its append-only guard
-- must allow that one anonymization transition while preserving every other
-- part of the audit record.
create or replace function public.prevent_audit_event_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_user_id is not null and new.actor_user_id is null
     and (to_jsonb(old) - 'actor_user_id') is not distinct from
       (to_jsonb(new) - 'actor_user_id') then
    return new;
  end if;
  raise exception 'audit events are append-only' using errcode = '55000';
end;
$$;

create function public.prevent_immutable_completion_changes()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_actor_column text := case tg_table_name
    when 'game_completion_reviews' then 'reviewer_user_id'
    when 'game_completions' then 'completed_by_user_id'
    else null end;
  v_old jsonb := to_jsonb(old);
  v_new jsonb := to_jsonb(new);
begin
  -- Preserve immutable completion evidence while allowing the declared auth
  -- foreign keys to anonymize a deleted account. No other value may change.
  if tg_op = 'UPDATE' and v_actor_column is not null
     and v_old->v_actor_column is distinct from 'null'::jsonb
     and v_new->v_actor_column = 'null'::jsonb
     and (v_old - v_actor_column) is not distinct from (v_new - v_actor_column) then
    return new;
  end if;
  raise exception 'completion_records_are_immutable' using errcode = '55000';
end;
$$;

create trigger prevent_completion_review_changes
before update or delete on public.game_completion_reviews
for each row execute function public.prevent_immutable_completion_changes();
create trigger prevent_completion_changes
before update or delete on public.game_completions
for each row execute function public.prevent_immutable_completion_changes();

create function public.authorize_game_completion_actor(
  p_game_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean
)
returns table (organization_id uuid, actor_kind text)
language plpgsql
security definer
set search_path = ''
as $$
declare v_org uuid;
begin
  select g.organization_id into v_org from public.games g where g.id = p_game_id;
  if not found then raise exception 'game_unavailable' using errcode = '42501'; end if;

  if p_actor_user_id is not null then
    if not exists (
      select 1 from auth.users u
      join public.user_profiles p on p.user_id = u.id
      join public.team_memberships m on m.user_id = p.user_id
      where u.id = p_actor_user_id and u.email_confirmed_at is not null
        and p.status = 'active'
        and m.organization_id = v_org and m.status = 'active'
        and m.role in ('owner', 'team_admin')
    ) then raise exception 'completion_administrator_required' using errcode = '42501'; end if;
    return query select v_org, 'account'::text;
    return;
  end if;

  if p_verified_organizer then
    return query select v_org, 'organizer'::text;
    return;
  end if;
  raise exception 'completion_authorization_required' using errcode = '42501';
end;
$$;

create function public.derive_game_completion_result(p_game_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_home bigint; v_away bigint; v_ends jsonb; v_count integer; v_outcome text;
begin
  with undone as (
    select e.payload->>'targetId' target_id
    from public.score_events e
    where e.game_id = p_game_id and e.event_type = 'undo'
  ), active_ends as (
    select e.sequence, e.payload->'score' score
    from public.score_events e
    where e.game_id = p_game_id and e.event_type = 'end'
      and not exists (select 1 from undone u where u.target_id = e.id::text)
  )
  select count(*)::integer,
    coalesce(sum(case when score->>'team' = 'home' then (score->>'points')::integer else 0 end), 0),
    coalesce(sum(case when score->>'team' = 'away' then (score->>'points')::integer else 0 end), 0),
    coalesce(jsonb_agg(score order by sequence), '[]'::jsonb)
  into v_count, v_home, v_away, v_ends from active_ends;

  v_outcome := case when v_count = 0 then 'no_result'
    when v_home = v_away then 'tie'
    when v_home > v_away then 'home_win' else 'away_win' end;
  return jsonb_build_object(
    'outcome', v_outcome,
    'label', case when v_count = 0 then 'No result recorded'
      when v_home = v_away then 'Tie'
      when v_home > v_away then 'Home win' else 'Away win' end,
    'totals', case when v_count = 0 then null else jsonb_build_object('home', v_home, 'away', v_away) end,
    'ends', v_ends
  );
end;
$$;

create function public.review_game_completion(
  p_game_id uuid,
  p_review_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean
)
returns table (review_id uuid, input_revision bigint, result jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare v_revision bigint; v_result jsonb; v_actor record; v_game record; v_state_status text;
begin
  perform 1 from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_state_unavailable' using errcode = '55000'; end if;
  select * into v_game from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '42501'; end if;
  select * into v_actor from public.authorize_game_completion_actor(p_game_id, p_actor_user_id, p_verified_organizer);
  select gs.state->>'status' into v_state_status from public.game_states gs where gs.game_id = p_game_id;
  if v_game.deleted_at is not null then raise exception 'game_deleted' using errcode = '55000'; end if;
  if v_game.completed_at is not null then raise exception 'game_already_completed' using errcode = '55000'; end if;
  if v_game.status = 'closed' or v_state_status = 'closed' then
    raise exception 'historical_closed_game' using errcode = '55000';
  end if;

  select r.revision into v_revision from public.game_result_revisions r where r.game_id = p_game_id;
  v_result := public.derive_game_completion_result(p_game_id);
  insert into public.game_completion_reviews(id, game_id, input_revision, result, reviewer_kind, reviewer_user_id)
  values (p_review_id, p_game_id, v_revision, v_result, v_actor.actor_kind,
    case when v_actor.actor_kind = 'account' then p_actor_user_id else null end);
  return query select p_review_id, v_revision, v_result;
end;
$$;

create function public.complete_reviewed_game(
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
  if not found then raise exception 'completion_review_required' using errcode = '40001'; end if;
  select r.revision into v_revision from public.game_result_revisions r where r.game_id = p_game_id;
  if v_revision is distinct from v_review.input_revision
     or public.derive_game_completion_result(p_game_id) is distinct from v_review.result then
    raise exception 'completion_review_conflict' using errcode = '40001';
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

-- Closed legacy games remain closed: only rows explicitly completed through the
-- function above receive completion metadata and an immutable result.
create or replace function public.read_game_state(p_game_id uuid)
returns table (outcome text, state jsonb)
language sql stable security definer set search_path = ''
as $$
  select case
      when g.deleted_at is not null then 'deleted'
      when g.completed_at is not null or g.status = 'closed' or gs.state->>'status' in ('closed', 'completed') then 'closed'
      when gs.state is null or gs.state->>'status' is distinct from 'active' then 'unavailable'
      else 'active' end,
    case when g.deleted_at is null and g.completed_at is null and g.status <> 'closed'
      and gs.state->>'status' = 'active' then gs.state else null end
  from public.games g left join public.game_states gs on gs.game_id = g.id
  where g.id = p_game_id;
$$;

-- Keep the deployed signature. The state row is the first lifecycle lock for
-- both the previous application and completion. Lock the parent next, before
-- the state update can advance the result-revision row; this prevents a
-- game -> revision writer from cycling with score's state -> revision -> game.
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
  if not found then raise exception 'stale game state for %', p_game_id using errcode = '40001'; end if;
  insert into public.score_events(id, game_id, event_type, payload, actor)
  values (p_event_id, p_game_id, p_event_type, p_payload, p_actor);
end;
$$;

-- The deployed schedule RPC keeps its signature, while taking the canonical
-- state lock before its existing games/state updates.
create or replace function public.update_scheduled_team_game(
 p_user_id uuid,p_game_id uuid,p_season_id uuid,p_event_id uuid,p_opponent_id uuid,
 p_scheduled_start timestamptz,p_timezone text,p_game_number integer,p_game_label text)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_old_opponent uuid; v_old_config jsonb; v_away text; v_event_name text;
begin
 perform 1 from public.game_states where game_id=p_game_id for update;
 if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,9));
 if p_scheduled_start is null or (p_event_id is not null and (p_game_number is null or p_game_number<=0))
   or (p_event_id is null and p_game_number is not null) then raise exception 'invalid_schedule' using errcode='22023'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
 if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then
   raise exception 'season_unavailable' using errcode='23514'; end if;
 if p_event_id is not null and not exists(select 1 from public.events where id=p_event_id and season_id=p_season_id and organization_id=v_org and archived_at is null) then
   raise exception 'event_unavailable' using errcode='23514'; end if;
 if p_event_id is not null then select name into v_event_name from public.events where id=p_event_id; end if;
 if p_opponent_id is not null then
   select display_name into v_away from public.opponents where id=p_opponent_id and organization_id=v_org and archived_at is null;
   if not found then raise exception 'opponent_unavailable' using errcode='23514'; end if;
 else v_away:='Opponent TBD'; end if;
 v_event_name:=coalesce(nullif(btrim(p_game_label),''),case when p_event_id is null then v_away||' — '||p_scheduled_start::date else v_event_name||' — Game '||p_game_number end);
 select opponent_id,config into v_old_opponent,v_old_config from public.games where id=p_game_id and organization_id=v_org and deleted_at is null for update;
 if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
 if v_old_opponent is distinct from p_opponent_id and exists(select 1 from public.score_events where game_id=p_game_id and event_type='end') then
   raise exception 'participant_locked' using errcode='23514'; end if;
 update public.games set season_id=p_season_id,event_id=p_event_id,opponent_id=p_opponent_id,
   scheduled_start=p_scheduled_start,schedule_timezone=p_timezone,game_number=p_game_number,game_label=nullif(btrim(p_game_label),''),
   config=jsonb_set(jsonb_set(config,'{awayName}',to_jsonb(v_away),true),'{eventName}',to_jsonb(v_event_name),true)
 where id=p_game_id;
 update public.game_states set state=jsonb_set(jsonb_set(state,'{config,awayName}',to_jsonb(v_away),true),'{config,eventName}',to_jsonb(v_event_name),true) where game_id=p_game_id;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'game.schedule_updated','game',p_game_id::text,jsonb_build_object('season_id',p_season_id,'event_id',p_event_id,'scheduled_start',p_scheduled_start,'game_number',p_game_number));
 if v_old_opponent is null and p_opponent_id is not null then
   insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
   values(p_user_id,v_org,'game.opponent_assigned','game',p_game_id::text,jsonb_build_object('opponent_id',p_opponent_id));
 end if;
end $$;

revoke all privileges on function
  public.bump_game_result_revision(uuid),
  public.guard_game_row_after_completion(),
  public.track_game_result_input_change(),
  public.guard_game_state_write(),
  public.track_game_state_result_input_change(),
  public.guard_score_event_write(),
  public.track_score_event_insert(),
  public.prevent_immutable_completion_changes(),
  public.authorize_game_completion_actor(uuid, uuid, boolean),
  public.derive_game_completion_result(uuid),
  public.review_game_completion(uuid, uuid, uuid, boolean),
  public.complete_reviewed_game(uuid, uuid, uuid, uuid, boolean),
  public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text)
from public, anon, authenticated, service_role;

grant execute on function
  public.review_game_completion(uuid, uuid, uuid, boolean),
  public.complete_reviewed_game(uuid, uuid, uuid, uuid, boolean),
  public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text)
to service_role;

revoke all privileges on function public.read_game_state(uuid),
  public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.read_game_state(uuid),
  public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
to service_role;

notify pgrst, 'reload schema';
