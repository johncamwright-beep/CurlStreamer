begin;

-- An ordered eight-rock lineup is a private session command, independent of
-- legacy position/stone slot labels and immutable recorded shot player IDs.
alter table public.curlcoach_commands drop constraint curlcoach_commands_command_type_check;
alter table public.curlcoach_commands add constraint curlcoach_commands_command_type_check
  check (command_type in ('command', 'finish', 'reopen', 'set-lineup'));

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
begin
  if p_request_id is null or p_expected_revision is null or p_expected_revision < 0
    or coalesce(p_command_type, '') not in ('command', 'finish', 'reopen', 'set-lineup')
    or coalesce(jsonb_typeof(p_payload), '') <> 'object'
    or coalesce(jsonb_typeof(p_next_state), '') <> 'object' then
    raise exception 'invalid curlcoach command' using errcode = '22023';
  end if;
  perform public.assert_curlcoach_actor(p_actor_user_id, p_organization_id, p_game_id);

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
    if not v_session_found or v_session.status <> 'closed'
      or coalesce(p_next_state ->> 'status', '') <> 'open'
      or v_next_events <> v_current_events then
      raise exception 'invalid curlcoach reopen command' using errcode = '22023';
    end if;
    v_next_status := 'open';
  end if;

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


commit;
