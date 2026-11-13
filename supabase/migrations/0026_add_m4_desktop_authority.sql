-- M4 desktop pairing only. No stream target, encoder start, or provider privilege.
create table public.m4_desktop_sessions (
  session_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  organization_id uuid not null references public.organizations(id),
  generation bigint not null check(generation>0),
  unique(game_id,generation),
  status text not null check(status in ('pending','active','revoked','stopped')),
  code_hash text not null unique check(code_hash ~ '^[0-9a-f]{64}$'),
  challenge_hash text not null check(challenge_hash ~ '^[0-9a-f]{64}$'),
  bearer_hash text check(bearer_hash ~ '^[0-9a-f]{64}$'),
  approved_by uuid references auth.users(id),
  pairing_expires_at timestamptz not null default now()+interval '5 minutes',
  consumed_at timestamptz,
  expires_at timestamptz,
  lease_expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.m4_desktop_sessions enable row level security;
revoke all on public.m4_desktop_sessions from public,anon,authenticated,service_role;

create function public.approve_m4_desktop_pairing(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_code_hash text,p_challenge_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_generation bigint; v_row public.m4_desktop_sessions;
begin
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' or p_challenge_hash is null or p_challenge_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid desktop pairing' using errcode='22023'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active' then raise exception 'terminal game' using errcode='55000'; end if;
  if exists(select 1 from public.m4_desktop_sessions s where s.game_id=p_game_id and
    ((s.status='pending' and s.pairing_expires_at>now()) or (s.status='active' and s.expires_at>now() and s.lease_expires_at>now()))) then raise exception 'desktop already assigned' using errcode='55000'; end if;
  select coalesce(max(s.generation),0)+1 into v_generation from public.m4_desktop_sessions s where s.game_id=p_game_id;
  update public.m4_desktop_sessions s set status='revoked',revoked_at=now() where s.game_id=p_game_id and s.status in ('pending','active');
  insert into public.m4_desktop_sessions(game_id,organization_id,generation,status,code_hash,challenge_hash,approved_by)
    values(p_game_id,v_game.organization_id,v_generation,'pending',p_code_hash,p_challenge_hash,p_actor_user_id) returning * into v_row;
  return query select v_row.session_id,v_row.generation,v_row.pairing_expires_at;
end $$;

create function public.exchange_m4_desktop_pairing(p_game_id uuid,p_code_hash text,p_challenge_hash text,p_bearer_hash text)
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
  update public.m4_desktop_sessions s set status='active',bearer_hash=p_bearer_hash,consumed_at=now(),expires_at=now()+interval '4 hours',lease_expires_at=now()+interval '30 seconds' where s.session_id=v_row.session_id returning * into v_row;
  return query select v_row.session_id,v_row.generation,v_row.expires_at,v_row.lease_expires_at;
end $$;

create function public.m4_desktop_authority_action(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_stop boolean)
returns table(session_id uuid,generation bigint,expires_at timestamptz,lease_expires_at timestamptz,desired_action text)
language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_row public.m4_desktop_sessions; v_terminal boolean;
begin
  if p_bearer_hash is null or p_bearer_hash !~ '^[0-9a-f]{64}$' or p_generation is null or p_generation<=0 then raise exception 'invalid desktop authority' using errcode='22023'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_row from public.m4_desktop_sessions s where s.game_id=p_game_id and s.session_id=p_session_id for update;
  if not found or v_game.id is null or v_row.organization_id<>v_game.organization_id or v_row.generation<>p_generation or v_row.bearer_hash is distinct from p_bearer_hash or v_row.expires_at is null or v_row.expires_at<=now() then raise exception 'desktop authority denied' using errcode='42501'; end if;
  v_terminal:=v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active';
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
    update public.m4_desktop_sessions s set lease_expires_at=least(s.expires_at,now()+interval '30 seconds') where s.session_id=v_row.session_id returning * into v_row;
  else raise exception 'desktop not active' using errcode='42501'; end if;
  return query select v_row.session_id,v_row.generation,v_row.expires_at,v_row.lease_expires_at,case when p_stop or v_terminal or v_row.status<>'active' then 'stop' else 'wait' end;
end $$;
create function public.heartbeat_m4_desktop(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz,lease_expires_at timestamptz,desired_action text)
language sql security definer set search_path='' as $$ select * from public.m4_desktop_authority_action(p_game_id,p_session_id,p_generation,p_bearer_hash,false) $$;
create function public.stop_m4_desktop(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz,lease_expires_at timestamptz,desired_action text)
language sql security definer set search_path='' as $$ select * from public.m4_desktop_authority_action(p_game_id,p_session_id,p_generation,p_bearer_hash,true) $$;

create function public.fence_terminal_m4_desktop() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null or new.completed_at is not null or new.status<>'active' then
    update public.m4_desktop_sessions set status='revoked',revoked_at=coalesce(revoked_at,now()) where game_id=new.id and status in ('pending','active');
  end if;
  return new;
end $$;
create trigger fence_terminal_m4_desktop after update of deleted_at,completed_at,status on public.games for each row execute function public.fence_terminal_m4_desktop();
revoke all on function public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text),public.exchange_m4_desktop_pairing(uuid,text,text,text),public.m4_desktop_authority_action(uuid,uuid,bigint,text,boolean),public.heartbeat_m4_desktop(uuid,uuid,bigint,text),public.stop_m4_desktop(uuid,uuid,bigint,text),public.fence_terminal_m4_desktop() from public,anon,authenticated,service_role;
grant execute on function public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text),public.exchange_m4_desktop_pairing(uuid,text,text,text),public.heartbeat_m4_desktop(uuid,uuid,bigint,text),public.stop_m4_desktop(uuid,uuid,bigint,text) to service_role;
notify pgrst,'reload schema';
