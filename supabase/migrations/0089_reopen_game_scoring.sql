-- Preserve every completion cycle; expose only the current completed result.
begin;
alter table public.game_completion_cleanup drop constraint game_completion_cleanup_game_id_fkey;
alter table public.game_completion_cleanup add foreign key(game_id) references public.games(id) on delete restrict;
alter table public.game_result_corrections drop constraint game_result_corrections_game_id_fkey;
alter table public.game_result_corrections add foreign key(game_id) references public.games(id) on delete restrict;
alter table public.game_completions rename to game_completion_history;
alter table public.game_completion_history drop constraint game_completions_pkey;
alter table public.game_completion_history add primary key(completion_id);
create index game_completion_history_game_idx on public.game_completion_history(game_id);
-- This single-table view remains insertable by complete_reviewed_game. The
-- completion pointer is set before that routine inserts its immutable record.
create view public.game_completions as
select c.* from public.game_completion_history c
where c.completion_id=(select g.completion_id from public.games g where g.id=c.game_id);
revoke all on public.game_completions,public.game_completion_history from public,anon,authenticated,service_role;

create or replace function public.prevent_immutable_completion_changes()
returns trigger language plpgsql set search_path='' as $$
declare v_column text:=case tg_table_name when 'game_completion_reviews' then 'reviewer_user_id'
  when 'game_completion_history' then 'completed_by_user_id' else null end;
begin
  if tg_op='UPDATE' and v_column is not null and to_jsonb(old)->v_column is distinct from 'null'::jsonb
    and to_jsonb(new)->v_column='null'::jsonb
    and (to_jsonb(old)-v_column) is not distinct from (to_jsonb(new)-v_column) then return new; end if;
  raise exception 'completion_records_are_immutable' using errcode='55000';
end $$;

create or replace function public.current_game_completion_result(p_game_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce((select r.result from public.game_result_corrections r
    where r.game_id=p_game_id and r.revision>c.input_revision order by r.revision desc limit 1),c.result)
  from public.game_completions c where c.game_id=p_game_id;
$$;

create table public.game_reopenings (
  request_id uuid primary key,
  game_id uuid not null references public.games(id),
  completion_id uuid not null references public.game_completion_history(completion_id),
  actor_user_id uuid references auth.users(id) on delete set null,
  expected_revision bigint not null,
  transaction_id bigint not null default txid_current(),
  snapshot jsonb not null,
  reopened_at timestamptz not null default now()
);
create index game_reopenings_game_idx on public.game_reopenings(game_id,transaction_id);
alter table public.game_reopenings enable row level security;
revoke all on public.game_reopenings from public,anon,authenticated,service_role;
create trigger game_reopenings_append_only before update or delete on public.game_reopenings
for each row execute function public.guard_game_result_correction_history();

create or replace function public.guard_game_row_after_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.completed_at is not null then raise exception 'completed_game_terminal' using errcode='55000'; end if;
    return old;
  end if;
  if old.completed_at is not null and new.status='active' and new.completed_at is null and new.completion_id is null
    and (to_jsonb(old)-array['status','completed_at','completion_id']) is not distinct from
        (to_jsonb(new)-array['status','completed_at','completion_id'])
    and exists(select 1 from public.game_reopenings r where r.game_id=old.id
      and r.completion_id=old.completion_id and r.transaction_id=txid_current()) then return new; end if;
  if old.completed_at is not null and (to_jsonb(new)-array['deleted_at','deleted_by_user_id']) is distinct from
    (to_jsonb(old)-array['deleted_at','deleted_by_user_id']) then
    raise exception 'completed_game_terminal' using errcode='55000';
  end if;
  return new;
end $$;

create or replace function public.guard_game_state_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_game_id uuid:=case when tg_op='DELETE' then old.game_id else new.game_id end; v_completed timestamptz;
begin
  if tg_op<>'INSERT' and old.state->>'status'='completed' then
    if tg_op<>'UPDATE' or new.state->>'status' is distinct from 'active'
      or not exists(select 1 from public.game_reopenings r where r.game_id=v_game_id and r.transaction_id=txid_current()) then
      raise exception 'completed_game_terminal' using errcode='55000';
    end if;
  end if;
  select completed_at into v_completed from public.games where id=v_game_id;
  if not found then raise exception 'game_unavailable' using errcode='23503'; end if;
  if v_completed is not null then raise exception 'completed_game_terminal' using errcode='55000'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;

create function public.reopen_completed_game(p_game_id uuid,p_actor_user_id uuid,p_request_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_state jsonb; v_result jsonb; v_revision bigint; v_existing public.game_reopenings;
  v_event jsonb; v_events jsonb; v_score jsonb; v_id uuid;
begin
  select state into v_state from public.game_states where game_id=p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
  select * into v_game from public.games where id=p_game_id for update;
  perform public.authorize_completed_result_actor(p_game_id,p_actor_user_id);
  if p_request_id is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'invalid_reopen_request' using errcode='22023'; end if;
  select * into v_existing from public.game_reopenings where request_id=p_request_id;
  if found then
    if v_existing.game_id<>p_game_id or v_existing.actor_user_id is distinct from p_actor_user_id
      or v_existing.expected_revision<>p_expected_revision or v_game.status<>'active' or v_game.deleted_at is not null then
      raise exception 'reopen_request_conflict' using errcode='PT409'; end if;
    return jsonb_build_object('status','active','gameId',p_game_id);
  end if;
  if v_game.deleted_at is not null or v_game.completed_at is null or v_game.status<>'completed' then
    raise exception 'completed_game_required' using errcode='55000'; end if;
  select revision into v_revision from public.game_result_revisions where game_id=p_game_id;
  if v_revision is distinct from p_expected_revision then raise exception 'result_revision_conflict' using errcode='PT409'; end if;
  if not exists(select 1 from public.game_completion_cleanup where game_id=p_game_id and status='complete')
    or exists(select 1 from public.game_completion_closing where game_id=p_game_id and deadline_at>clock_timestamp()) then
    raise exception 'game_still_closing' using errcode='PT423'; end if;
  v_result:=public.current_game_completion_result(p_game_id);
  insert into public.game_reopenings(request_id,game_id,completion_id,actor_user_id,expected_revision,snapshot)
    values(p_request_id,p_game_id,v_game.completion_id,p_actor_user_id,p_expected_revision,
      jsonb_build_object('result',v_result,'state',v_state,
        'cleanup',(select to_jsonb(c) from public.game_completion_cleanup c where game_id=p_game_id),
        'closing',(select to_jsonb(c) from public.game_completion_closing c where game_id=p_game_id)));
  update public.games set status='active',completed_at=null,completion_id=null where id=p_game_id;
  v_events:=coalesce(v_state->'scoreEvents','[]'::jsonb);
  -- Final-score corrections become normal append-only undo/end events. Never
  -- replace a saved event or silently revert the corrected result on reopening.
  if v_result->'ends' is distinct from public.derive_game_completion_result(p_game_id)->'ends' then
    for v_event in select e.payload from public.score_events e where e.game_id=p_game_id and e.event_type='end'
      and not exists(select 1 from public.score_events u where u.game_id=p_game_id and u.event_type='undo'
        and u.payload->>'targetId'=e.id::text) order by e.sequence loop
      v_id:=gen_random_uuid();
      v_event:=jsonb_build_object('id',v_id,'type','undo','targetId',v_event->>'id','at',(extract(epoch from clock_timestamp())*1000)::bigint);
      insert into public.score_events(id,game_id,event_type,payload,actor) values(v_id,p_game_id,'undo',v_event,p_actor_user_id::text);
      v_events:=v_events||jsonb_build_array(v_event);
    end loop;
    for v_score in select value from jsonb_array_elements(v_result->'ends') loop
      v_id:=gen_random_uuid();
      v_event:=jsonb_build_object('id',v_id,'type','end','score',v_score,'at',(extract(epoch from clock_timestamp())*1000)::bigint);
      insert into public.score_events(id,game_id,event_type,payload,actor) values(v_id,p_game_id,'end',v_event,p_actor_user_id::text);
      v_events:=v_events||jsonb_build_array(v_event);
    end loop;
  end if;
  update public.game_states set state=v_state||jsonb_build_object('status','active','scoreEvents',v_events),
    version=greatest(version+1,(extract(epoch from clock_timestamp())*1000)::bigint),updated_at=now() where game_id=p_game_id;
  perform public.bump_game_result_revision(p_game_id);
  delete from public.game_completion_cleanup where game_id=p_game_id;
  delete from public.game_completion_closing where game_id=p_game_id;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_actor_user_id,v_game.organization_id,'game.reopened','game',p_game_id::text,
      jsonb_build_object('completion_id',v_game.completion_id,'request_id',p_request_id));
  return jsonb_build_object('status','active','gameId',p_game_id);
end $$;
revoke all on function public.reopen_completed_game(uuid,uuid,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.reopen_completed_game(uuid,uuid,uuid,bigint) to service_role;
notify pgrst,'reload schema';
commit;
