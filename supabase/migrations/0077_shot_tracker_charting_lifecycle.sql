begin;

create or replace function public.apply_curlcoach_command(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid,
  p_request_id uuid,
  p_expected_revision bigint,
  p_command_type text,
  p_payload jsonb,
  p_next_state jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.curlcoach_sessions%rowtype;
  v_command public.curlcoach_commands%rowtype;
  v_session_found boolean := false;
  v_next_revision bigint;
  v_next_status text;
  v_current_events jsonb;
  v_next_events jsonb;
  v_game_status text;
begin
  if p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or coalesce(p_command_type, '') not in ('command', 'finish', 'reopen', 'set-lineup')
    or coalesce(jsonb_typeof(p_payload), '') <> 'object'
    or coalesce(jsonb_typeof(p_next_state), '') <> 'object' then
    raise exception 'invalid curlcoach command' using errcode = '22023';
  end if;
  perform public.assert_curlcoach_actor(p_actor_user_id, p_organization_id, p_game_id);

  select status into v_game_status from public.games where id=p_game_id and organization_id=p_organization_id for share;
  if v_game_status = 'deleted' then raise exception 'Deleted games cannot be charted' using errcode='55000'; end if;
  select * into v_session from public.curlcoach_sessions
  where organization_id = p_organization_id and game_id = p_game_id
    and actor_user_id = p_actor_user_id
  for update;
  v_session_found := found;

  if v_session_found then
    select * into v_command from public.curlcoach_commands
    where session_id = v_session.id and request_id = p_request_id;
    if found then
      if v_command.expected_revision <> p_expected_revision
        or v_command.command_type <> p_command_type
        or v_command.payload <> p_payload then
        raise exception 'curlcoach request id already used' using errcode = '23505';
      end if;
      return v_command.result_state;
    end if;
  elsif p_expected_revision <> 0 then
    raise exception 'curlcoach revision conflict' using errcode = '40001';
  end if;

  -- Only the explicit lifecycle command may grant completed-game charting.
  if p_command_type='reopen' then
    if p_next_state->'reopened' is distinct from 'true'::jsonb then raise exception 'Reopen marker required'; end if;
  elsif p_command_type='finish' then
    if coalesce(p_next_state->'reopened','false'::jsonb) <> 'false'::jsonb then raise exception 'Finish clears reopen marker'; end if;
  elsif coalesce(p_next_state->'reopened','false'::jsonb) is distinct from coalesce(v_session.state->'reopened','false'::jsonb) then
    raise exception 'Reopen requires lifecycle command';
  end if;
  if v_game_status in ('completed','closed') and p_command_type <> 'reopen' and coalesce(v_session.state->>'reopened','false') <> 'true' then
    raise exception 'Closed games require explicit reopen' using errcode='55000';
  end if;
  if p_command_type='command' and coalesce(jsonb_array_length(v_session.state->'events'),0)=0 and coalesce(jsonb_array_length(v_session.state->'lineupEvents'),0)=0 then
    raise exception 'Confirm lineup before charting' using errcode='55000';
  end if;
  v_next_revision := p_expected_revision + 1;
  if coalesce(p_next_state ->> 'organizationId', '') <> p_organization_id::text
    or coalesce(p_next_state ->> 'gameId', '') <> p_game_id::text
    or coalesce(p_next_state ->> 'profile', '') <> 'tracker-provisional-v1'
    or coalesce(p_next_state ->> 'revision', '') !~ '^[0-9]+$'
    or (p_next_state ->> 'revision')::bigint <> v_next_revision
    or coalesce(p_next_state ->> 'status', '') not in ('open', 'closed')
    or jsonb_typeof(p_next_state -> 'events') <> 'array'
    or jsonb_typeof(p_next_state -> 'roster') <> 'array' then
    raise exception 'invalid curlcoach state' using errcode = '22023';
  end if;

  if v_session_found and v_session.revision <> p_expected_revision then
    raise exception 'curlcoach revision conflict' using errcode = '40001';
  end if;
  v_current_events := coalesce(v_session.state -> 'events', '[]'::jsonb);
  v_next_events := p_next_state -> 'events';
  if v_session_found and p_next_state -> 'roster' <> v_session.state -> 'roster' then
    raise exception 'curlcoach roster snapshot is immutable' using errcode = '22023';
  end if;

  -- Every existing shot event and lineup audit entry remains immutable.
  if exists (
    select 1 from jsonb_array_elements(v_current_events) with ordinality old(event, slot)
    where v_next_events -> (old.slot::integer - 1) is distinct from old.event
  ) then
    raise exception 'curlcoach shot events are append only' using errcode = '22023';
  end if;
  if p_command_type <> 'set-lineup' and (
    p_next_state -> 'lineup' is distinct from v_session.state -> 'lineup'
    or coalesce(p_next_state -> 'lineupEvents', '[]'::jsonb) <> coalesce(v_session.state -> 'lineupEvents', '[]'::jsonb)
  ) then
    raise exception 'lineup requires a lineup command' using errcode = '22023';
  end if;

  if p_command_type = 'set-lineup' then
    if (v_session_found and v_session.status <> 'open')
      or p_next_state ->> 'status' <> 'open'
      or v_next_events <> v_current_events
      or coalesce(p_payload ->> 'requestId', '') <> p_request_id::text
      or coalesce(p_payload ->> 'expectedRevision', '') <> p_expected_revision::text
      or coalesce(p_payload ->> 'action', '') <> 'set-lineup'
      or coalesce(jsonb_typeof(p_payload -> 'lineup'), '') <> 'array'
      or p_next_state -> 'lineup' is distinct from p_payload -> 'lineup'
      or coalesce(jsonb_typeof(p_next_state -> 'lineupEvents'), '') <> 'array' then
      raise exception 'invalid curlcoach lineup command' using errcode = '22023';
    end if;
    if jsonb_array_length(p_payload -> 'lineup') <> 8 or exists (
      select 1 from jsonb_array_elements(p_payload -> 'lineup') player
      where jsonb_typeof(player) <> 'string' or not exists (
        select 1 from jsonb_array_elements(p_next_state -> 'roster') entry
        where entry ->> 'id' = player #>> '{}'
      )
    ) then
      raise exception 'lineup requires eight known roster players' using errcode = '22023';
    end if;
    if jsonb_array_length(p_next_state -> 'lineupEvents') <> jsonb_array_length(coalesce(v_session.state -> 'lineupEvents', '[]'::jsonb)) + 1
      or exists (
        select 1 from jsonb_array_elements(coalesce(v_session.state -> 'lineupEvents', '[]'::jsonb)) with ordinality old(event, slot)
        where p_next_state -> 'lineupEvents' -> (old.slot::integer - 1) is distinct from old.event
      )
      or (p_next_state -> 'lineupEvents' -> -1) - 'revision' - 'at' - 'actor' <> p_payload
      or coalesce(p_next_state -> 'lineupEvents' -> -1 ->> 'revision', '') <> v_next_revision::text
      or coalesce(p_next_state -> 'lineupEvents' -> -1 ->> 'actor', '') <> p_actor_user_id::text then
      raise exception 'invalid curlcoach lineup audit' using errcode = '22023';
    end if;
    v_next_status := 'open';
  elsif p_command_type = 'command' then
    if (v_session_found and v_session.status <> 'open')
      or coalesce(p_payload ->> 'requestId', '') <> p_request_id::text
      or coalesce(p_payload ->> 'expectedRevision', '') !~ '^[0-9]+$'
      or (p_payload ->> 'expectedRevision')::bigint <> p_expected_revision
      or coalesce(p_next_state ->> 'status', '') <> 'open'
      or jsonb_array_length(v_next_events) <> jsonb_array_length(v_current_events) + 1
      or coalesce(v_next_events -> -1 ->> 'requestId', '') <> p_request_id::text then
      raise exception 'invalid curlcoach shot command' using errcode = '22023';
    end if;
    v_next_status := 'open';
  elsif p_command_type = 'finish' then
    if (v_session_found and v_session.status <> 'open')
      or coalesce(p_next_state ->> 'status', '') <> 'closed'
      or v_next_events <> v_current_events then
      raise exception 'invalid curlcoach finish command' using errcode = '22023';
    end if;
    v_next_status := 'closed';
  else
    if (v_session_found and v_session.status <> 'closed' and coalesce(v_session.state->>'reopened','false')='true')
      or coalesce(p_next_state ->> 'status', '') <> 'open'
      or v_next_events <> v_current_events then
      raise exception 'invalid curlcoach reopen command' using errcode = '22023';
    end if;
    v_next_status := 'open';
  end if;

  perform set_config('curlcoach.command_type',p_command_type,true);
  if not v_session_found then
    insert into public.curlcoach_sessions(
      organization_id, game_id, actor_user_id, status, revision, state, closed_at
    ) values (
      p_organization_id, p_game_id, p_actor_user_id, v_next_status,
      v_next_revision, p_next_state,
      case when v_next_status = 'closed' then now() else null end
    ) returning * into v_session;
  else
    update public.curlcoach_sessions set
      status = v_next_status,
      revision = v_next_revision,
      state = p_next_state,
      updated_at = now(),
      closed_at = case when v_next_status = 'closed' then now() else null end
    where id = v_session.id
    returning * into v_session;
  end if;

  perform set_config('curlcoach.command_type','',true);
  insert into public.curlcoach_commands(
    session_id, request_id, expected_revision, revision, command_type,
    payload, result_state, actor_user_id
  ) values (
    v_session.id, p_request_id, p_expected_revision, v_next_revision,
    p_command_type, p_payload, p_next_state, p_actor_user_id
  );
  return p_next_state;
end;
$$;


create or replace function public.guard_curlcoach_closed_game()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_status text; v_action text := current_setting('curlcoach.command_type',true);
begin
 select status into v_status from public.games where id=new.game_id and organization_id=new.organization_id for share;
 if not found or v_status='deleted' then raise exception 'Game unavailable' using errcode='55000'; end if;
 if v_status in ('completed','closed') and not coalesce((
   (v_action='reopen' and new.state->>'reopened'='true') or
   (tg_op='UPDATE' and old.state->>'reopened'='true' and v_action in ('command','set-lineup','finish'))
 ),false) then raise exception 'Closed games require explicit reopen' using errcode='55000'; end if;
 if tg_op='UPDATE' and old.status='closed' and coalesce(v_action,'')<>'reopen' then raise exception 'Closed coaching session' using errcode='55000'; end if;
 return new;
end $$;

create or replace function public.read_curlcoach_states(p_actor_user_id uuid,p_organization_id uuid,p_game_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_result jsonb:='{}'::jsonb; v_state jsonb;
begin
 foreach v_id in array p_game_ids loop
   perform public.assert_curlcoach_actor(p_actor_user_id,p_organization_id,v_id);
   select state into v_state from public.curlcoach_sessions where organization_id=p_organization_id and actor_user_id=p_actor_user_id and game_id=v_id;
   if found then v_result:=v_result||jsonb_build_object(v_id::text,v_state); end if;
 end loop;
 return v_result;
end $$;
revoke all on function public.read_curlcoach_states(uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.read_curlcoach_states(uuid,uuid,uuid[]) to service_role;
commit;
