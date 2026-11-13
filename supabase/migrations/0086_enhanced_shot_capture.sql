begin;
-- Additive audit documents. Standard session JSON and its command schema stay unchanged.
create table public.shot_tracker_enhanced_commands (
  sequence bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid not null references auth.users(id),
  kind text not null check(kind in ('preferences','context','supplement')),
  game_id uuid references public.games(id), shot_id uuid,
  request_id uuid not null unique, revision bigint not null check(revision > 0),
  source_revision bigint not null check(source_revision >= 0),
  input jsonb not null, value jsonb not null, result_state jsonb,
  created_at timestamptz not null default now(),
  check ((kind='preferences' and game_id is null and shot_id is null)
    or (kind='context' and game_id is not null and shot_id is null)
    or (kind='supplement' and game_id is not null and shot_id is not null))
);
create index shot_tracker_enhanced_scope on public.shot_tracker_enhanced_commands
  (organization_id,actor_user_id,kind,game_id,shot_id,revision desc);
alter table public.shot_tracker_enhanced_commands enable row level security;
revoke all on public.shot_tracker_enhanced_commands from anon,authenticated,service_role;
create trigger shot_tracker_enhanced_immutable before update or delete on public.shot_tracker_enhanced_commands
for each row execute function public.reject_curlcoach_command_mutation();

create function public.read_shot_tracker_enhanced(p_actor uuid,p_org uuid,p_game uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_curlcoach_access(p_actor,p_org);
  if p_game is not null then
    perform public.assert_curlcoach_actor(p_actor,p_org,p_game);
    if exists(select 1 from public.games where id=p_game and (deleted_at is not null or status='deleted')) then
      raise exception 'Game unavailable' using errcode='42501'; end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'shotId',shot_id,'revision',revision,
    'sourceRevision',source_revision,'value',value,'at',created_at)) from (
    select distinct on (kind,shot_id) * from public.shot_tracker_enhanced_commands
    where organization_id=p_org and actor_user_id=p_actor
      and (kind='preferences' or game_id=p_game)
    order by kind,shot_id,revision desc
  ) latest),'[]'::jsonb);
end; $$;

create function public.save_shot_tracker_enhanced(
 p_actor uuid,p_org uuid,p_game uuid,p_shot uuid,p_kind text,p_request uuid,
 p_expected bigint,p_source_revision bigint,p_value jsonb,
 p_standard_command jsonb default null,p_next_state jsonb default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare old public.shot_tracker_enhanced_commands%rowtype; previous_document public.shot_tracker_enhanced_commands%rowtype; latest_revision bigint;
 request_input jsonb; result jsonb; shot_event jsonb; previous_shot jsonb; session_state jsonb; saved_value jsonb;
begin
 perform public.assert_curlcoach_access(p_actor,p_org);
 if p_kind not in ('preferences','context','supplement') or p_expected is null or p_expected < 0
   or p_source_revision is null or p_source_revision < 0 or p_request is null or jsonb_typeof(p_value) is distinct from 'object'
   or ((p_kind='preferences') <> (p_game is null)) or ((p_kind='supplement') <> (p_shot is not null))
   or (p_standard_command is not null and p_kind<>'supplement') then
   raise exception 'Invalid Enhanced command' using errcode='22023'; end if;
 if p_game is not null then
   perform public.assert_curlcoach_actor(p_actor,p_org,p_game);
   perform 1 from public.games where id=p_game and organization_id=p_org and deleted_at is null and status<>'deleted' for share;
   if not found then raise exception 'Game unavailable' using errcode='42501'; end if;
 end if;
 -- Serializes first insert, preferences and supplements for this private source.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text||':'||p_actor::text,0));
 request_input:=jsonb_build_object('expected',p_expected,'sourceRevision',p_source_revision,'value',p_value,'command',p_standard_command);
 select * into old from public.shot_tracker_enhanced_commands where request_id=p_request;
 if found then
   if old.organization_id<>p_org or old.actor_user_id<>p_actor or old.kind<>p_kind
     or old.game_id is distinct from p_game or old.shot_id is distinct from p_shot or old.input<>request_input then
     raise exception 'Request ID already used' using errcode='23505'; end if;
   return jsonb_build_object('revision',old.revision,'sourceRevision',old.source_revision,'value',old.value,'at',old.created_at,'state',old.result_state);
 end if;
 select * into previous_document from public.shot_tracker_enhanced_commands
 where organization_id=p_org and actor_user_id=p_actor and kind=p_kind
   and game_id is not distinct from p_game and shot_id is not distinct from p_shot order by revision desc limit 1;
 latest_revision:=coalesce(previous_document.revision,0);
 if latest_revision<>p_expected then raise exception 'Enhanced revision conflict' using errcode='40001'; end if;
 if p_game is not null then
   select state into session_state from public.curlcoach_sessions
   where organization_id=p_org and actor_user_id=p_actor and game_id=p_game for update;
 end if;
 if p_standard_command is not null then
   if p_standard_command->>'shotId' is distinct from p_shot::text
     or p_standard_command->>'requestId' is distinct from p_request::text then
     raise exception 'Standard identity mismatch' using errcode='22023'; end if;
   -- An older Standard-only retry cannot be retroactively called an atomic save.
   if exists(select 1 from public.curlcoach_commands c join public.curlcoach_sessions s on s.id=c.session_id
     where s.organization_id=p_org and s.actor_user_id=p_actor and s.game_id=p_game and c.request_id=p_request) then
     raise exception 'Request already used by Standard save' using errcode='23505'; end if;
   result:=public.apply_curlcoach_command(p_actor,p_org,p_game,p_request,
     (p_standard_command->>'expectedRevision')::bigint,'command',p_standard_command,p_next_state);
   session_state:=result;
 end if;
 if p_kind='supplement' then
   select e into shot_event from jsonb_array_elements(session_state->'events') with ordinality entries(e,n)
     where e->>'shotId'=p_shot::text order by n desc limit 1;
   if shot_event is null or shot_event->'shot'='null'::jsonb then raise exception 'Shot unavailable' using errcode='42501'; end if;
   if (shot_event->>'revision')::bigint<>p_source_revision then raise exception 'Source shot revision conflict' using errcode='40001'; end if;
   if previous_document.revision is not null then
     select e->'shot' into previous_shot from jsonb_array_elements(session_state->'events') e
       where e->>'shotId'=p_shot::text and (e->>'revision')::bigint=previous_document.source_revision;
     if (previous_shot is null or exists(select 1 from unnest(array['playerId','position','end','stone']) k
       where previous_shot->k is distinct from shot_event->'shot'->k))
       and length(trim(coalesce(p_value->'values'->>'sourceReconciliation','')))=0 then
       raise exception 'Explicit source identity reconciliation required' using errcode='22023'; end if;
   end if;
   if p_value->>'version' is distinct from 'enhanced-v1' or p_value->>'mappingVersion' is distinct from 'enhanced-v1'
     or jsonb_typeof(p_value->'values') is distinct from 'object' or jsonb_typeof(p_value->'assessments') is distinct from 'object' then
     raise exception 'Invalid supplement version' using errcode='22023'; end if;
   if coalesce(p_value->>'definitionRevision','') !~ '^[0-9]+$' or
     ((p_value->>'definitionRevision')::bigint>0 and not exists (
       select 1 from public.shot_tracker_enhanced_commands where organization_id=p_org and actor_user_id=p_actor
       and kind='preferences' and revision=(p_value->>'definitionRevision')::bigint
     )) then raise exception 'Call definition version unavailable' using errcode='22023'; end if;
   if coalesce(p_value->>'contextRevision','0') !~ '^[0-9]+$' then raise exception 'Invalid context version' using errcode='22023'; end if;
   if coalesce((p_value->>'contextRevision')::bigint,0)>0 then
     if not exists(select 1 from public.shot_tracker_enhanced_commands where organization_id=p_org and actor_user_id=p_actor
       and game_id=p_game and kind='context' and revision=(p_value->>'contextRevision')::bigint
       and value=p_value->'contextSnapshot') then raise exception 'Game context version unavailable' using errcode='22023'; end if;
   elsif coalesce(p_value->'contextSnapshot','{}'::jsonb)<>'{}'::jsonb then raise exception 'Unversioned game context' using errcode='22023'; end if;
 end if;
 saved_value:=p_value;
 if p_kind='supplement' then
   saved_value:=jsonb_set(p_value,'{retrospective}',to_jsonb(p_standard_command is null or exists(
     select 1 from jsonb_array_elements(session_state->'events') e where e->>'shotId'=p_shot::text
     and (e->>'revision')::bigint<p_source_revision
   )));
 end if;
 insert into public.shot_tracker_enhanced_commands(organization_id,actor_user_id,kind,game_id,shot_id,request_id,revision,source_revision,input,value,result_state)
 values(p_org,p_actor,p_kind,p_game,p_shot,p_request,latest_revision+1,p_source_revision,request_input,saved_value,result) returning * into old;
 return jsonb_build_object('revision',old.revision,'sourceRevision',old.source_revision,'value',old.value,'at',old.created_at,'state',result);
end; $$;
revoke all on function public.read_shot_tracker_enhanced(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.save_shot_tracker_enhanced(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.read_shot_tracker_enhanced(uuid,uuid,uuid) to service_role;
grant execute on function public.save_shot_tracker_enhanced(uuid,uuid,uuid,uuid,text,uuid,bigint,bigint,jsonb,jsonb,jsonb) to service_role;
commit;
