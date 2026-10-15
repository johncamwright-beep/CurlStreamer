-- Resume an existing, unexpired receiver scope after a missed heartbeat.
-- SHARE protects those reads against release, completion and deletion while allowing
-- independent camera roles to check/renew concurrently. Keep role-row UPDATE locks
-- and the game-state -> game -> session lock order. No grant or expiry changes.

create or replace function public.m2_studio_action(
  p_game_id uuid, p_camera_role text, p_action text, p_side text,
  p_session_id uuid default null, p_negotiation_id uuid default null,
  p_device_id uuid default null, p_assignment_generation bigint default null,
  p_organization_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_state jsonb;
  v_game public.games%rowtype;
  v_session public.m2_studio_sessions%rowtype;
  v_generation bigint;
begin
  if p_action is null or p_side is null or p_camera_role is null or p_camera_role not in ('camera-home','camera-away') or p_side not in ('receiver','camera') or p_action not in ('register','begin','ticket','check','stop','signal')
    or (p_action in ('register','stop') and p_side <> 'receiver')
    or (p_action='begin' and p_side <> 'camera') then
    raise exception 'invalid_studio_action' using errcode='22023';
  end if;
  select state into v_state from public.game_states where game_id=p_game_id for share;
  if not found then raise exception 'game_unavailable' using errcode='55000'; end if;
  select * into v_game from public.games where id=p_game_id for share;
  if not found or v_game.deleted_at is not null or v_game.completed_at is not null
    or v_state->>'status' is distinct from 'active' or v_game.status <> 'active' then
    raise exception 'game_unavailable' using errcode='55000';
  end if;
  if p_organization_id is not null and p_organization_id <> v_game.organization_id then
    raise exception 'studio_denied' using errcode='42501';
  end if;
  v_generation:=coalesce((v_state#>>array['claimGenerations',p_camera_role])::bigint,0);
  if p_side='camera' and (p_device_id is null or p_assignment_generation is null
    or (v_state#>>array['claims',p_camera_role]) is distinct from p_device_id::text
    or v_generation <> p_assignment_generation) then
    raise exception 'camera_released' using errcode='42501';
  end if;
  if p_action='register' then
    insert into public.m2_studio_sessions(game_id,camera_role,organization_id,id,status)
    values(p_game_id,p_camera_role,v_game.organization_id,gen_random_uuid(),'active')
    on conflict(game_id,camera_role) do update set id=gen_random_uuid(),generation=nextval('public.m2_studio_generation'),
      status='active',receiver_seen_at=now(),expires_at=now()+interval '4 hours',
      negotiation_id=null,assignment_generation=null,camera_device_id=null,camera_seen_at=null,
      signal_count=0,signal_window_at=now()
    returning * into v_session;
  else
    select * into v_session from public.m2_studio_sessions where game_id=p_game_id and camera_role=p_camera_role for update;
    if not found or v_session.status <> 'active' or v_session.expires_at <= now()
      or (v_session.receiver_seen_at <= now()-interval '30 seconds' and not (p_side='receiver' and p_action='check' and p_negotiation_id is null))
      or (p_session_id is not null and p_session_id <> v_session.id)
      or (p_side='receiver' and p_session_id is null) then
      raise exception 'studio_stale' using errcode='55000';
    end if;
    -- Only a validated receiver with the exact current session may resume. No
    -- cookie/session expiry extension, stopped-session revival or new claim.
    -- Invalidate old negotiation so expired camera/channel tickets cannot resume.
    if v_session.receiver_seen_at <= now()-interval '30 seconds' then
      update public.m2_studio_sessions set negotiation_id=null,
        assignment_generation=null,camera_device_id=null,camera_seen_at=null,
        signal_count=0,signal_window_at=now()
        where game_id=p_game_id and camera_role=p_camera_role returning * into v_session;
    end if;
    if p_action='begin' then
      update public.m2_studio_sessions set negotiation_id=gen_random_uuid(),
        assignment_generation=v_generation,camera_device_id=p_device_id,camera_seen_at=now(),
        signal_window_at=now(),signal_count=0 where game_id=p_game_id and camera_role=p_camera_role returning * into v_session;
    elsif p_action='stop' then
      update public.m2_studio_sessions set status='stopped' where game_id=p_game_id and camera_role=p_camera_role returning * into v_session;
    else
      -- A receiver may heartbeat while waiting for the first claim. It cannot get a channel yet.
      if p_action <> 'check' or p_negotiation_id is not null or p_side='camera' then
        if v_session.negotiation_id is null or v_session.assignment_generation is distinct from v_generation
          or (v_state#>>array['claims',p_camera_role]) is distinct from v_session.camera_device_id::text
          or v_session.camera_seen_at <= now()-interval '30 seconds'
          or (p_negotiation_id is not null and p_negotiation_id <> v_session.negotiation_id)
          or (p_action='signal' and p_negotiation_id is null) then
          raise exception 'peer_stale' using errcode='55000';
        end if;
      end if;
      if p_action='signal' then
        if v_session.signal_window_at < now()-interval '1 minute' then
          v_session.signal_window_at:=now(); v_session.signal_count:=0;
        end if;
        if v_session.signal_count >= 240 then raise exception 'signal_limit' using errcode='54000'; end if;
        v_session.signal_count:=v_session.signal_count+1;
      end if;
      update public.m2_studio_sessions set
        receiver_seen_at=case when p_side='receiver' then now() else receiver_seen_at end,
        camera_seen_at=case when p_side='camera' then now() else camera_seen_at end,
        signal_count=v_session.signal_count,signal_window_at=v_session.signal_window_at
        where game_id=p_game_id and camera_role=p_camera_role returning * into v_session;
    end if;
  end if;
  return jsonb_build_object('cameraRole',v_session.camera_role,'sessionId',v_session.id,'generation',v_session.generation,
    'negotiationId',v_session.negotiation_id,'assignmentGeneration',v_session.assignment_generation,
    'expiresAt',least(extract(epoch from v_session.expires_at),extract(epoch from now())+20)*1000);
end;
$$;
revoke all on function public.m2_studio_action(uuid,text,text,text,uuid,uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.m2_studio_action(uuid,text,text,text,uuid,uuid,uuid,bigint,uuid) to service_role;

notify pgrst, 'reload schema';
