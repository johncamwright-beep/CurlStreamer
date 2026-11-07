-- M4 reservation and sticky delivery quarantine. No target or encoder is exposed.
create table public.m4_output_intents (
  intent_id uuid primary key,
  game_id uuid not null references public.games(id),
  organization_id uuid not null references public.organizations(id),
  session_id uuid not null references public.m4_desktop_sessions(session_id),
  generation bigint not null,
  broadcast_generation bigint not null,
  youtube_broadcast_id text not null,
  youtube_stream_id text not null,
  phase text not null check(phase in ('reserved','quarantined','stop_requested')),
  delivery_recorded_at timestamptz,
  created_at timestamptz not null default now()
);
create index m4_output_game on public.m4_output_intents(game_id);
alter table public.m4_output_intents enable row level security;
revoke all on public.m4_output_intents from public,anon,authenticated,service_role;

-- Private helper follows the shared lock order and returns server-only rows.
create function public.validate_m4_output_authority(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text)
returns public.broadcast_sessions language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_broadcast public.broadcast_sessions; v_desktop public.m4_desktop_sessions;
begin
  if p_generation is null or p_generation<=0 or p_bearer_hash is null or p_bearer_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid output authority' using errcode='22023'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_broadcast from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
  select * into v_desktop from public.m4_desktop_sessions where game_id=p_game_id and session_id=p_session_id for update;
  if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
    or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active' then raise exception 'terminal output' using errcode='55000'; end if;
  if v_desktop.session_id is null or v_desktop.organization_id<>v_game.organization_id or v_desktop.generation<>p_generation or v_desktop.bearer_hash is distinct from p_bearer_hash
    or v_desktop.status<>'active' or v_desktop.expires_at is null or v_desktop.expires_at<=now() or v_desktop.lease_expires_at is null or v_desktop.lease_expires_at<=now()
    or p_generation<>(select max(generation) from public.m4_desktop_sessions where game_id=p_game_id) then raise exception 'desktop authority expired' using errcode='42501'; end if;
  if v_desktop.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_desktop.approved_by,false); end if;
  if v_broadcast.id is null or v_broadcast.organization_id<>v_game.organization_id or v_broadcast.transport<>'local-obs' or v_broadcast.status<>'prepared' or v_broadcast.desired_state<>'live'
    or v_broadcast.youtube_broadcast_id is null or v_broadcast.youtube_stream_id is null or v_broadcast.youtube_broadcast_create_state<>'ready' or v_broadcast.youtube_stream_create_state<>'ready'
    or v_broadcast.uncertain_since is not null then raise exception 'output not prepared' using errcode='55000'; end if;
  return v_broadcast;
end $$;

create function public.claim_m4_output_intent(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,phase text,delivery_recorded boolean)
language plpgsql security definer set search_path='' as $$
declare v_broadcast public.broadcast_sessions; v_intent public.m4_output_intents;
begin
  if p_intent_id is null then raise exception 'invalid output intent' using errcode='22023'; end if;
  v_broadcast:=public.validate_m4_output_authority(p_game_id,p_session_id,p_generation,p_bearer_hash);
  select * into v_intent from public.m4_output_intents i where i.intent_id=p_intent_id for update;
  if found then
    if v_intent.game_id<>p_game_id or v_intent.session_id<>p_session_id or v_intent.generation<>p_generation or v_intent.organization_id<>v_broadcast.organization_id
      or v_intent.broadcast_generation<>v_broadcast.operation_generation or v_intent.youtube_broadcast_id<>v_broadcast.youtube_broadcast_id or v_intent.youtube_stream_id<>v_broadcast.youtube_stream_id
      or v_intent.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  else
    if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.delivery_recorded_at is not null) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
    if exists(select 1 from public.m4_output_intents i join public.m4_desktop_sessions s on s.session_id=i.session_id where i.game_id=p_game_id and i.phase='reserved' and s.status='active' and s.expires_at>now() and s.lease_expires_at>now()) then raise exception 'output already reserved' using errcode='55000'; end if;
    update public.m4_output_intents i set phase='stop_requested' where i.game_id=p_game_id and i.phase='reserved';
    insert into public.m4_output_intents(intent_id,game_id,organization_id,session_id,generation,broadcast_generation,youtube_broadcast_id,youtube_stream_id,phase)
      values(p_intent_id,p_game_id,v_broadcast.organization_id,p_session_id,p_generation,v_broadcast.operation_generation,v_broadcast.youtube_broadcast_id,v_broadcast.youtube_stream_id,'reserved') returning * into v_intent;
  end if;
  return query select v_intent.intent_id,v_intent.session_id,v_intent.generation,v_intent.phase,v_intent.delivery_recorded_at is not null;
end $$;
create function public.mark_m4_output_delivery(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,phase text,delivery_recorded boolean)
language plpgsql security definer set search_path='' as $$
declare v_broadcast public.broadcast_sessions; v_intent public.m4_output_intents;
begin
  v_broadcast:=public.validate_m4_output_authority(p_game_id,p_session_id,p_generation,p_bearer_hash);
  select * into v_intent from public.m4_output_intents i where i.intent_id=p_intent_id for update;
  if not found or v_intent.game_id<>p_game_id or v_intent.session_id<>p_session_id or v_intent.generation<>p_generation or v_intent.organization_id<>v_broadcast.organization_id
    or v_intent.broadcast_generation<>v_broadcast.operation_generation or v_intent.youtube_broadcast_id<>v_broadcast.youtube_broadcast_id or v_intent.youtube_stream_id<>v_broadcast.youtube_stream_id
    or v_intent.phase='stop_requested' then raise exception 'output intent mismatch' using errcode='42501'; end if;
  if exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.intent_id<>p_intent_id and i.delivery_recorded_at is not null) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  update public.m4_output_intents i set delivery_recorded_at=coalesce(i.delivery_recorded_at,now()),phase='quarantined' where i.intent_id=p_intent_id returning * into v_intent;
  -- This safe receipt is NOT permission to fetch or redeliver a target.
  return query select v_intent.intent_id,v_intent.session_id,v_intent.generation,v_intent.phase,true;
end $$;

-- A delivery barrier is intentionally sticky, even after Stop or lease expiry.
-- No client acknowledgment or retirement API can clear it in this milestone.
alter function public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text) rename to pre_quarantine_approve_m4_desktop_pairing;
alter function public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) rename to pre_quarantine_claim_m4_broadcast_operation;
revoke all on function public.pre_quarantine_approve_m4_desktop_pairing(uuid,uuid,boolean,text,text),public.pre_quarantine_claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
create function public.approve_m4_desktop_pairing(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_code_hash text,p_challenge_hash text)
returns table(session_id uuid,generation bigint,expires_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  perform 1 from public.games where id=p_game_id for update;
  perform 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if exists(select 1 from public.m4_output_intents where game_id=p_game_id and delivery_recorded_at is not null) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  return query select * from public.pre_quarantine_approve_m4_desktop_pairing(p_game_id,p_actor_user_id,p_verified_organizer,p_code_hash,p_challenge_hash);
end $$;
create function public.claim_m4_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  perform 1 from public.games where id=p_game_id for update;
  perform 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if p_desired_state='prepared' and exists(select 1 from public.m4_output_intents where game_id=p_game_id and delivery_recorded_at is not null) then raise exception 'output delivery quarantined' using errcode='55000'; end if;
  return public.pre_quarantine_claim_m4_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,p_desired_state,p_operation_token);
end $$;
create function public.fence_terminal_m4_output() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null or new.completed_at is not null or new.status<>'active' then
    update public.m4_output_intents set phase='stop_requested' where game_id=new.id;
  end if;
  return new;
end $$;
create trigger fence_terminal_m4_output after update of deleted_at,completed_at,status on public.games for each row execute function public.fence_terminal_m4_output();
revoke all on function public.validate_m4_output_authority(uuid,uuid,bigint,text),public.claim_m4_output_intent(uuid,uuid,bigint,text,uuid),public.mark_m4_output_delivery(uuid,uuid,bigint,text,uuid),public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text),public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid),public.fence_terminal_m4_output() from public,anon,authenticated,service_role;
grant execute on function public.claim_m4_output_intent(uuid,uuid,bigint,text,uuid),public.mark_m4_output_delivery(uuid,uuid,bigint,text,uuid),public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text),public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) to service_role;
notify pgrst,'reload schema';
