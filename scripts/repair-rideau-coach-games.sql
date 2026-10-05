-- Authorized October 5, 2026: separate game four from game three.
-- Execute BEFORE 0072. All changes use append-only commands in one transaction.
-- Assertions abort if live records differ. A second execution cannot duplicate data.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';
do $$
#variable_conflict use_column
declare
  s public.curlcoach_sessions%rowtype;
  target constant uuid := 'c8b19da4-cb4f-402e-ae0c-428d4eff459b';
  repair constant text := 'rideau-games-3-4-2026-10-05';
  a jsonb;
  b jsonb;
  payload jsonb;
  shot jsonb;
  ev jsonb;
  row_data record;
  request uuid;
  rev bigint;
  original jsonb;
  morning jsonb;
  expected_evening jsonb;
  actual jsonb;
begin
  -- Lock both shared games and the private source before checking expectations.
  perform 1 from public.games where id in
    ('d4909708-4e33-4ed6-8909-2b3d4d3b12e3', target) order by id for update;
  select * into strict s from public.curlcoach_sessions
    where id = '5a673cef-fec2-43ab-b79d-d32fc64c2e3b' for update;
  if s.game_id <> 'd4909708-4e33-4ed6-8909-2b3d4d3b12e3'
    or s.revision <> 121 or s.status <> 'closed'
    or jsonb_array_length(s.state->'events') <> 120 or s.state ? 'lineup'
    or exists(select 1 from public.curlcoach_sessions where game_id=target)
    or (select count(*) from public.games where id in (s.game_id,target)
      and organization_id=s.organization_id
      and event_id='1a798edc-d561-4cce-b253-ebebda9eb3c5'
      and status='active' and deleted_at is null and completed_at is null) <> 2
  then raise exception 'Recovery preflight changed; stop and investigate'; end if;
  if (select count(*) from public.curlcoach_commands where session_id=s.id) <> 121
    or (select count(distinct payload->>'shotId') from public.curlcoach_commands
      where session_id=s.id and revision between 58 and 120
      and command_type='command' and (payload->'shot'->>'end')::int between 8 and 15
      and created_at between '2026-10-03 21:15Z' and '2026-10-04 00:18Z') <> 63
    or exists(select 1 from public.curlcoach_commands e join public.curlcoach_commands m
      on m.session_id=e.session_id and m.payload->>'shotId'=e.payload->>'shotId'
      where e.session_id=s.id and e.revision between 58 and 120 and m.revision<=57)
  then raise exception 'Recovery shot boundary changed'; end if;
  original := s.state;
  select result_state into strict morning from public.curlcoach_commands
    where session_id=s.id and revision=57;
  select jsonb_object_agg(payload->>'shotId',
    jsonb_set(payload->'shot','{end}',to_jsonb((payload->'shot'->>'end')::int-7)))
    into expected_evening from public.curlcoach_commands
    where session_id=s.id and revision between 58 and 120;

  -- Durable repair provenance lives on immutable lifecycle commands.
  request := gen_random_uuid();
  payload := jsonb_build_object('action','reopen','requestId',request,'expectedRevision',121,
    'repair',jsonb_build_object('id',repair,'reason','User-authorized split of evening game four from morning game three',
      'sourceOriginalRevision',121,'targetGameId',target,'sourceRevisions',jsonb_build_array(58,120),'endOffset',-7));
  a := original || jsonb_build_object('status','open','revision',122);
  perform public.apply_curlcoach_command(s.actor_user_id,s.organization_id,s.game_id,request,121,'reopen',payload,a);
  b := jsonb_build_object('organizationId',s.organization_id,'gameId',target,
    'profile',original->>'profile','roster',original->'roster','status','open','revision',0,'events','[]'::jsonb);
  for row_data in select * from public.curlcoach_commands
    where session_id=s.id and revision between 58 and 120 order by revision
  loop
    shot := jsonb_set(row_data.payload->'shot','{end}',to_jsonb((row_data.payload->'shot'->>'end')::int-7));
    rev := (b->>'revision')::bigint;
    request := gen_random_uuid();
    payload := jsonb_build_object('requestId',request,'expectedRevision',rev,'shotId',row_data.payload->>'shotId','shot',shot);
    ev := payload || jsonb_build_object('revision',rev+1,'at',row_data.result_state->'events'->-1->>'at','actor',s.actor_user_id);
    b := b || jsonb_build_object('revision',rev+1,'events',(b->'events')||jsonb_build_array(ev));
    perform public.apply_curlcoach_command(s.actor_user_id,s.organization_id,target,request,rev,'command',payload,b);

    rev := (a->>'revision')::bigint;
    request := gen_random_uuid();
    payload := jsonb_build_object('requestId',request,'expectedRevision',rev,'shotId',row_data.payload->>'shotId','shot',null);
    ev := payload || jsonb_build_object('revision',rev+1,'at',to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'actor',s.actor_user_id);
    a := a || jsonb_build_object('revision',rev+1,'events',(a->'events')||jsonb_build_array(ev));
    perform public.apply_curlcoach_command(s.actor_user_id,s.organization_id,s.game_id,request,rev,'command',payload,a);
  end loop;
  rev := (a->>'revision')::bigint;
  request := gen_random_uuid();
  payload := jsonb_build_object('action','finish','requestId',request,'expectedRevision',rev,'repair',repair,'targetGameId',target);
  a := a || jsonb_build_object('revision',rev+1,'status','closed');
  perform public.apply_curlcoach_command(s.actor_user_id,s.organization_id,s.game_id,request,rev,'finish',payload,a);
  rev := (b->>'revision')::bigint;
  request := gen_random_uuid();
  payload := jsonb_build_object('action','finish','requestId',request,'expectedRevision',rev,'repair',repair,'sourceGameId',s.game_id,'sourceRevision',121);
  b := b || jsonb_build_object('revision',rev+1,'status','closed');
  perform public.apply_curlcoach_command(s.actor_user_id,s.organization_id,target,request,rev,'finish',payload,b);

  -- Compare derived shots exactly, including notes, flags and grades.
  select jsonb_object_agg(id,shot) into actual from (
    select distinct on (e->>'shotId') e->>'shotId' id,e->'shot' shot
    from jsonb_array_elements(a->'events') with ordinality x(e,n)
    order by e->>'shotId',n desc) q where shot <> 'null'::jsonb;
  if actual is distinct from (select jsonb_object_agg(id,shot) from (
    select distinct on (e->>'shotId') e->>'shotId' id,e->'shot' shot
    from jsonb_array_elements(morning->'events') with ordinality x(e,n)
    order by e->>'shotId',n desc) q where shot <> 'null'::jsonb)
    or (select count(*) from jsonb_object_keys(actual)) <> 56
  then raise exception 'Morning verification failed'; end if;
  select jsonb_object_agg(e->>'shotId',e->'shot') into actual from jsonb_array_elements(b->'events') e;
  if actual is distinct from expected_evening
    or (select count(*) from jsonb_object_keys(actual)) <> 63
    or (select result_state from public.curlcoach_commands where session_id=s.id and revision=121) <> original
  then raise exception 'Evening or original history verification failed'; end if;
end;
$$;
commit;
