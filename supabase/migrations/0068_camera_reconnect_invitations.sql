-- Explicit organizer-approved renewal of an existing camera assignment.
-- This never releases a camera, increments its generation or stops a session.
create function public.prepare_game_camera_reconnect(
  p_game_id uuid, p_role text, p_invitation_id uuid, p_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_state jsonb;
  v_device uuid;
  v_generation bigint;
begin
  if p_role is null or p_role not in ('camera-home','camera-away')
    or p_invitation_id is null or p_expires_at is null
    or p_expires_at <= now() or p_expires_at > now()+interval '11 minutes' then
    raise exception 'invalid_invitation' using errcode='22023';
  end if;
  select state into v_state from public.game_states where game_id=p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode='55000'; end if;
  perform 1 from public.games where id=p_game_id and deleted_at is null and completed_at is null and status='active' for update;
  if not found or v_state->>'status' is distinct from 'active' then
    raise exception 'game_unavailable' using errcode='55000';
  end if;
  v_device := nullif(v_state#>>array['claims',p_role],'')::uuid;
  if v_device is null then raise exception 'camera_unassigned' using errcode='55000'; end if;
  v_generation := coalesce((v_state#>>array['claimGenerations',p_role])::bigint,0);
  -- Mark as consumed by the existing device: claim_game_role permits only an
  -- idempotent exchange by that same device while its generation is current.
  insert into public.game_invitations(id,game_id,role,token_hash,expires_at,expected_generation,consumed_at,consumed_by_device_id,assigned_generation)
  values(p_invitation_id,p_game_id,replace(p_role,'-','_')::public.game_role,p_invitation_id::text,p_expires_at,v_generation,now(),v_device,v_generation);
  return jsonb_build_object('deviceId',v_device,'generation',v_generation);
end;
$$;
revoke all on function public.prepare_game_camera_reconnect(uuid,text,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.prepare_game_camera_reconnect(uuid,text,uuid,timestamptz) to service_role;
