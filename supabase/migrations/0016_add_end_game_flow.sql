-- End Game application surface. Completion remains server-role-only; browser
-- callers reach it only through the authenticated/organizer server route.

create function public.is_valid_youtube_watch_url(p_value text)
returns boolean language sql immutable set search_path = '' as $$
  select p_value is null or (
    length(p_value) <= 500 and (
      p_value ~ '^https://(www\.)?youtube\.com/watch\?[^#]*v=[A-Za-z0-9_-]{6,}([&#][^#]*)?$'
      or p_value ~ '^https://(www\.)?youtube\.com/live/[A-Za-z0-9_-]{6,}([?&#][^#]*)?$'
      or p_value ~ '^https://youtu\.be/[A-Za-z0-9_-]{6,}([?&#][^#]*)?$'
    )
  );
$$;

alter table public.game_completion_reviews
  add column youtube_watch_url text
  check (public.is_valid_youtube_watch_url(youtube_watch_url));
alter table public.game_completions
  add column youtube_watch_url text
  check (public.is_valid_youtube_watch_url(youtube_watch_url));

alter table public.game_completion_cleanup
  drop constraint game_completion_cleanup_status_check;
alter table public.game_completion_cleanup
  add constraint game_completion_cleanup_status_check
  check (status in ('pending', 'failed', 'complete'));
alter table public.game_completion_cleanup add column last_error text
  check (last_error is null or length(last_error) <= 500);

create function public.review_game_completion_with_link(
  p_game_id uuid,
  p_review_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_youtube_watch_url text
)
returns table (review_id uuid, input_revision bigint, result jsonb, youtube_watch_url text)
language plpgsql security definer set search_path = '' as $$
declare v_revision bigint; v_result jsonb; v_actor record; v_game record; v_state_status text;
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
  insert into public.game_completion_reviews(
    id, game_id, input_revision, result, reviewer_kind, reviewer_user_id,
    youtube_watch_url)
  values (p_review_id, p_game_id, v_revision, v_result, v_actor.actor_kind,
    case when v_actor.actor_kind = 'account' then p_actor_user_id else null end,
    p_youtube_watch_url);
  return query select p_review_id, v_revision, v_result, p_youtube_watch_url;
end;
$$;

create function public.copy_review_watch_url_to_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select r.youtube_watch_url into new.youtube_watch_url
  from public.game_completion_reviews r where r.id = new.review_id;
  return new;
end;
$$;
create trigger copy_review_watch_url_to_completion
before insert on public.game_completions
for each row execute function public.copy_review_watch_url_to_completion();

create function public.read_game_completion_summary(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', 'completed',
    'eventName', c.result_context->>'eventName',
    'homeName', c.result_context->>'homeName',
    'awayName', c.result_context->>'awayName',
    'result', c.result,
    'youtubeWatchUrl', c.youtube_watch_url,
    'completedAt', c.completed_at)
  from public.game_completions c
  join public.games g on g.id = c.game_id
  where c.game_id = p_game_id and g.deleted_at is null;
$$;

create function public.get_game_completion_cleanup(
  p_game_id uuid, p_actor_user_id uuid, p_verified_organizer boolean)
returns table (status text, attempts integer, last_error text)
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.authorize_game_completion_actor(
    p_game_id, p_actor_user_id, p_verified_organizer);
  return query select c.status, c.attempts, c.last_error
    from public.game_completion_cleanup c where c.game_id = p_game_id;
end;
$$;

create function public.record_game_completion_cleanup(
  p_game_id uuid, p_actor_user_id uuid, p_verified_organizer boolean,
  p_succeeded boolean, p_error text)
returns table (status text, attempts integer, last_error text)
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.authorize_game_completion_actor(
    p_game_id, p_actor_user_id, p_verified_organizer);
  update public.game_completion_cleanup c set
    attempts = c.attempts + 1,
    last_attempted_at = now(),
    status = case when p_succeeded then 'complete' else 'failed' end,
    last_error = case when p_succeeded then null
      else left(coalesce(nullif(p_error, ''), 'Provider cleanup was not confirmed'), 500) end,
    completed_at = case when p_succeeded then now() else null end
  where c.game_id = p_game_id and c.status <> 'complete';
  return query select c.status, c.attempts, c.last_error
    from public.game_completion_cleanup c where c.game_id = p_game_id;
end;
$$;

drop function public.list_team_hierarchy_games(uuid);
create function public.list_team_hierarchy_games(p_user_id uuid)
returns table(
  id uuid, season_id uuid, event_id uuid, opponent_id uuid,
  scheduled_start timestamptz, schedule_timezone text, game_number integer,
  game_label text, created_at timestamptz, game_status text, config jsonb,
  completion_result jsonb, youtube_watch_url text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  return query select g.id,g.season_id,g.event_id,g.opponent_id,
    g.scheduled_start,g.schedule_timezone,g.game_number,g.game_label,
    g.created_at,coalesce(gs.state->>'status',g.status),g.config,
    c.result,c.youtube_watch_url
  from public.games g
  left join public.game_states gs on gs.game_id = g.id
  left join public.game_completions c on c.game_id = g.id
  where g.organization_id = v_org and g.deleted_at is null
  order by g.scheduled_start asc nulls last,g.created_at desc,g.id;
end;
$$;

revoke all privileges on function
  public.is_valid_youtube_watch_url(text),
  public.review_game_completion_with_link(uuid,uuid,uuid,boolean,text),
  public.copy_review_watch_url_to_completion(),
  public.read_game_completion_summary(uuid),
  public.get_game_completion_cleanup(uuid,uuid,boolean),
  public.record_game_completion_cleanup(uuid,uuid,boolean,boolean,text),
  public.list_team_hierarchy_games(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.review_game_completion_with_link(uuid,uuid,uuid,boolean,text),
  public.read_game_completion_summary(uuid),
  public.get_game_completion_cleanup(uuid,uuid,boolean),
  public.record_game_completion_cleanup(uuid,uuid,boolean,boolean,text),
  public.list_team_hierarchy_games(uuid)
to service_role;

notify pgrst, 'reload schema';
