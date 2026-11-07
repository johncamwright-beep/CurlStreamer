-- A verified desktop grant tolerates a brief network outage for up to 90 seconds.
-- Studio feeds its separate <=30-second native watchdog only from the unexpired
-- acknowledged grant. Controller death still stops locally within 30 seconds.
-- Explicit Stop/revocation and bounded final-card closing retain their existing
-- behavior. During total network loss, remote revocation takes at most 90 seconds.
-- Older Studio versions retain their stricter 30-second local bound.
begin;
create or replace function public.exchange_m4_desktop_pairing(p_game_id uuid,p_code_hash text,p_challenge_hash text,p_bearer_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz,lease_expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_row public.m4_desktop_sessions;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$' or p_bearer_hash is null or p_bearer_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid desktop exchange' using errcode='22023'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active' then raise exception 'terminal game' using errcode='55000'; end if;
  select * into v_row from public.m4_desktop_sessions s where s.game_id=p_game_id and s.code_hash=p_code_hash for update;
  if not found or v_row.organization_id<>v_game.organization_id or v_row.challenge_hash<>p_challenge_hash or v_row.status<>'pending' or v_row.consumed_at is not null or v_row.pairing_expires_at<=now() then raise exception 'desktop exchange denied' using errcode='42501'; end if;
  if v_row.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_row.approved_by,false); end if;
  update public.m4_desktop_sessions s set status='active',bearer_hash=p_bearer_hash,consumed_at=now(),expires_at=now()+interval '4 hours',lease_expires_at=now()+interval '90 seconds' where s.session_id=v_row.session_id returning * into v_row;
  return query select v_row.session_id,v_row.generation,v_row.expires_at,v_row.lease_expires_at;
end $$;

create or replace function public.m4_desktop_authority_action(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_stop boolean)
returns table(session_id uuid,generation bigint,expires_at timestamptz,lease_expires_at timestamptz,desired_action text)
language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_row public.m4_desktop_sessions; v_terminal boolean; v_closing public.game_completion_closing; v_closing_valid boolean;
begin
  if p_bearer_hash is null or p_bearer_hash !~ '^[0-9a-f]{64}$' or p_generation is null or p_generation<=0 then raise exception 'invalid desktop authority' using errcode='22023'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_row from public.m4_desktop_sessions s where s.game_id=p_game_id and s.session_id=p_session_id for update;
  if not found or v_game.id is null or v_row.organization_id<>v_game.organization_id or v_row.generation<>p_generation or v_row.bearer_hash is distinct from p_bearer_hash or v_row.expires_at is null or v_row.expires_at<=now() then raise exception 'desktop authority denied' using errcode='42501'; end if;
  select * into v_closing from public.game_completion_closing where game_id=p_game_id;
  v_closing_valid:=v_closing.game_id is not null and v_closing.session_id=v_row.session_id and v_closing.generation=v_row.generation
    and v_closing.deadline_at>now() and v_row.status='active' and v_game.deleted_at is null
    and v_game.status='completed' and v_game.completed_at is not null
    and exists(select 1 from public.m4_output_intents where intent_id=v_closing.intent_id and phase='quarantined' and delivery_recorded_at is not null);
  v_terminal:=v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active';
  if v_closing_valid then v_terminal:=false; end if;
  if v_row.approved_by is not null then
    begin
      perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_row.approved_by,false);
    exception when insufficient_privilege then v_terminal:=true;
    end;
  end if;
  if exists(select 1 from public.broadcast_sessions b where b.game_id=p_game_id and b.provider='youtube' and b.transport='local-obs' and b.desired_state='stopped' and b.operation_generation>0) then v_terminal:=true; end if;
  if p_stop then
    update public.m4_desktop_sessions s set status='stopped',revoked_at=coalesce(s.revoked_at,now()) where s.session_id=v_row.session_id returning * into v_row;
  elsif v_row.lease_expires_at is null or v_row.lease_expires_at<=now() then raise exception 'desktop lease expired' using errcode='55000';
  elsif v_terminal or v_row.status in ('revoked','stopped') then
    update public.m4_desktop_sessions s set status=case when s.status='stopped' then 'stopped' else 'revoked' end,revoked_at=coalesce(s.revoked_at,now()) where s.session_id=v_row.session_id returning * into v_row;
  elsif v_row.status='active' then
    update public.m4_desktop_sessions s set lease_expires_at=least(s.expires_at,case when v_closing_valid then v_closing.deadline_at else now()+interval '90 seconds' end) where s.session_id=v_row.session_id returning * into v_row;
  else raise exception 'desktop not active' using errcode='42501'; end if;
  return query select v_row.session_id,v_row.generation,v_row.expires_at,v_row.lease_expires_at,case when p_stop or v_terminal or v_row.status<>'active' then 'stop' else 'wait' end;
end $$;
commit;

