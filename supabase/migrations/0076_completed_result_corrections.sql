-- Append audited corrections without reopening a completed game or changing
-- its immutable completion, score events, broadcast identity or cleanup tasks.
-- Prerequisites: migrations through 0075; final projections from 0035/0064.
begin;

create table public.game_result_corrections (
  game_id uuid not null references public.game_completions(game_id) on delete restrict,
  request_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  expected_revision bigint not null check (expected_revision >= 0),
  revision bigint not null check (revision > expected_revision),
  ends jsonb not null check (jsonb_typeof(ends) = 'array'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  corrected_at timestamptz not null default now(),
  primary key (game_id, request_id),
  unique (game_id, revision)
);
alter table public.game_result_corrections enable row level security;
revoke all on public.game_result_corrections from public, anon, authenticated, service_role;

create function public.guard_game_result_correction_history()
returns trigger language plpgsql set search_path='' as $$
begin
  -- Match completion evidence: deleting an auth account may anonymize its
  -- declared FK, but cannot alter any result or audit data.
  if tg_op='UPDATE' and old.actor_user_id is not null and new.actor_user_id is null
    and (to_jsonb(old)-'actor_user_id') is not distinct from (to_jsonb(new)-'actor_user_id') then
    return new;
  end if;
  raise exception 'result_corrections_append_only' using errcode='55000';
end $$;
create trigger game_result_corrections_append_only
before update or delete on public.game_result_corrections
for each row execute function public.guard_game_result_correction_history();

create function public.current_game_completion_result(p_game_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(
    (select r.result from public.game_result_corrections r where r.game_id=p_game_id order by r.revision desc limit 1),
    c.result)
  from public.game_completions c where c.game_id=p_game_id;
$$;

create function public.derive_corrected_game_result(p_ends jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v_end jsonb; v_index integer:=0; v_points integer; v_home integer:=0; v_away integer:=0; v_outcome text;
begin
  if p_ends is null or jsonb_typeof(p_ends)<>'array' or jsonb_array_length(p_ends)>30 then
    raise exception 'invalid_corrected_ends' using errcode='22023';
  end if;
  for v_end in select value from jsonb_array_elements(p_ends) loop
    v_index:=v_index+1;
    if jsonb_typeof(v_end)<>'object'
      or (select count(*) from jsonb_object_keys(v_end))<>4
      or not (v_end ?& array['end','team','points','blank'])
      or jsonb_typeof(v_end->'end') is distinct from 'number'
      or jsonb_typeof(v_end->'points') is distinct from 'number'
      or jsonb_typeof(v_end->'blank') is distinct from 'boolean'
      or (v_end->>'end') !~ '^[0-9]+$' or (v_end->>'points') !~ '^[0-9]+$' then
      raise exception 'invalid_corrected_end' using errcode='22023';
    end if;
    if (v_end->>'end')::numeric<>v_index or (v_end->>'points')::numeric not between 0 and 8 then
      raise exception 'invalid_corrected_end' using errcode='22023';
    end if;
    v_points:=(v_end->>'points')::integer;
    if (v_end->>'blank')::boolean then
      if v_end->'team' is distinct from 'null'::jsonb or v_points<>0 then
        raise exception 'invalid_blank_end' using errcode='22023';
      end if;
    else
      if coalesce(v_end->>'team','') not in ('home','away') or v_points<1 then
        raise exception 'invalid_scored_end' using errcode='22023';
      end if;
      if v_end->>'team'='home' then v_home:=v_home+v_points; else v_away:=v_away+v_points; end if;
    end if;
  end loop;
  v_outcome:=case when v_index=0 then 'no_result' when v_home=v_away then 'tie' when v_home>v_away then 'home_win' else 'away_win' end;
  return jsonb_build_object('outcome',v_outcome,
    'label',case v_outcome when 'no_result' then 'No result recorded' when 'tie' then 'Tie' when 'home_win' then 'Home win' else 'Away win' end,
    'totals',case when v_index=0 then null else jsonb_build_object('home',v_home,'away',v_away) end,'ends',p_ends);
end $$;

create function public.authorize_completed_result_actor(p_game_id uuid,p_actor_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from public.games g join public.team_memberships m on m.organization_id=g.organization_id
    join public.user_profiles p on p.user_id=m.user_id join auth.users u on u.id=p.user_id
    where g.id=p_game_id and u.id=p_actor_user_id and u.email_confirmed_at is not null
      and p.status='active' and m.status='active' and m.role in ('owner','team_admin')
  ) then raise exception 'result_administrator_required' using errcode='42501'; end if;
end $$;

create function public.read_completed_game_result(p_game_id uuid,p_actor_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_revision bigint;
begin
  -- Same lifecycle lock order as completion, deletion and configuration edits.
  perform 1 from public.game_states where game_id=p_game_id for share;
  if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
  select * into v_game from public.games where id=p_game_id for share;
  if not found or p_actor_user_id is null then raise exception 'administrator_required' using errcode='42501'; end if;
  perform public.authorize_completed_result_actor(p_game_id,p_actor_user_id);
  if v_game.deleted_at is not null or v_game.completed_at is null or v_game.status::text<>'completed' then
    raise exception 'completed_game_required' using errcode='55000';
  end if;
  select revision into v_revision from public.game_result_revisions where game_id=p_game_id;
  if v_revision is null then raise exception 'result_revision_unavailable' using errcode='55000'; end if;
  return jsonb_build_object('completion',public.read_game_completion_summary(p_game_id),'revision',v_revision);
end $$;

create function public.correct_completed_game_result(
  p_game_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_revision bigint,p_ends jsonb,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_existing public.game_result_corrections; v_revision bigint; v_result jsonb; v_completion jsonb;
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  if not found or p_actor_user_id is null then raise exception 'administrator_required' using errcode='42501'; end if;
  -- Rechecks verified email, active profile and same-organization owner/admin.
  -- Organizer links, scorers and game operators do not receive this authority.
  perform public.authorize_completed_result_actor(p_game_id,p_actor_user_id);
  if v_game.deleted_at is not null or v_game.completed_at is null or v_game.status::text<>'completed' then
    raise exception 'completed_game_required' using errcode='55000';
  end if;
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0
    or p_expected_revision>9007199254740991 or p_reason is null or length(btrim(p_reason)) not between 1 and 500 then
    raise exception 'invalid_correction_request' using errcode='22023';
  end if;
  v_result:=public.derive_corrected_game_result(p_ends);
  select * into v_existing from public.game_result_corrections where game_id=p_game_id and request_id=p_request_id;
  if found then
    if v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.expected_revision<>p_expected_revision or v_existing.ends is distinct from p_ends
      or v_existing.reason is distinct from btrim(p_reason) then
      raise exception 'correction_request_reused' using errcode='PT409';
    end if;
    -- The ledger proves the original request was committed. Return the current
    -- canonical projection so a delayed retry cannot display an older result.
    select revision into v_revision from public.game_result_revisions where game_id=p_game_id;
    return jsonb_build_object('completion',public.read_game_completion_summary(p_game_id),'revision',v_revision);
  end if;
  select revision into v_revision from public.game_result_revisions where game_id=p_game_id for update;
  if v_revision is null or v_revision<>p_expected_revision then
    raise exception 'result_revision_conflict' using errcode='PT409';
  end if;
  perform public.bump_game_result_revision(p_game_id);
  select revision into v_revision from public.game_result_revisions where game_id=p_game_id;
  if v_revision>9007199254740991 then raise exception 'result_revision_overflow' using errcode='22003'; end if;
  insert into public.game_result_corrections(game_id,request_id,actor_user_id,expected_revision,revision,ends,result,reason)
    values(p_game_id,p_request_id,p_actor_user_id,p_expected_revision,v_revision,p_ends,v_result,btrim(p_reason));
  v_completion:=jsonb_set(public.read_game_completion_summary(p_game_id),'{result}',v_result);
  return jsonb_build_object('completion',v_completion,'revision',v_revision);
end $$;

-- Fail closed if a deployed projection differs from the known final definitions.
-- Changing only c.result preserves names, watch links, publication and team scope.
do $projection$
declare v_target regprocedure; v_source text; v_updated text;
begin
  foreach v_target in array array[
    'public.read_game_completion_summary(uuid)'::regprocedure,
    'public.read_public_team_games(uuid)'::regprocedure
  ] loop
    select pg_get_functiondef(v_target) into v_source;
    if (select count(*) from regexp_matches(v_source,'c\.result\M','g'))<>1 then
      raise exception 'expected one completion result projection in %',v_target;
    end if;
    v_updated:=regexp_replace(v_source,'c\.result\M','public.current_game_completion_result(c.game_id)','g');
    execute v_updated;
  end loop;
end $projection$;

-- 0042 added scheduled YouTube columns but removed the earlier completion
-- columns. Restore them while retaining every latest scheduling field.
drop function public.list_team_hierarchy_games(uuid);
create function public.list_team_hierarchy_games(p_user_id uuid)
returns table(id uuid,season_id uuid,event_id uuid,opponent_id uuid,scheduled_start timestamptz,
  schedule_timezone text,game_number integer,game_label text,created_at timestamptz,game_status text,
  config jsonb,youtube_scheduled_watch_url text,youtube_scheduled_status text,
  completion_result jsonb,youtube_watch_url text)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin
  return query select g.id,g.season_id,g.event_id,g.opponent_id,g.scheduled_start,g.schedule_timezone,
    g.game_number,g.game_label,g.created_at,coalesce(gs.state->>'status',g.status),g.config,
    g.youtube_scheduled_watch_url,g.youtube_scheduled_status,
    public.current_game_completion_result(c.game_id),c.youtube_watch_url
  from public.games g left join public.game_states gs on gs.game_id=g.id
  left join public.game_completions c on c.game_id=g.id
  where g.organization_id=v_org and g.deleted_at is null
  order by g.scheduled_start asc nulls last,g.created_at desc,g.id;
end $$;

revoke all on function public.guard_game_result_correction_history(),public.current_game_completion_result(uuid),
  public.authorize_completed_result_actor(uuid,uuid),
  public.derive_corrected_game_result(jsonb),public.read_completed_game_result(uuid,uuid),
  public.list_team_hierarchy_games(uuid),
  public.correct_completed_game_result(uuid,uuid,uuid,bigint,jsonb,text)
  from public,anon,authenticated,service_role;
grant execute on function public.read_completed_game_result(uuid,uuid),
  public.list_team_hierarchy_games(uuid),
  public.correct_completed_game_result(uuid,uuid,uuid,bigint,jsonb,text) to service_role;

notify pgrst,'reload schema';
commit;
