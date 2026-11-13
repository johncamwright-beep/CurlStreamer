-- The only terminal exception is an immutable fifteen-second final-card lease
-- for an output that was already delivered. No general read/ARM/target scopes change.
create table public.game_completion_closing (
  game_id uuid primary key references public.games(id),
  session_id uuid not null references public.m4_desktop_sessions(session_id),
  generation bigint not null check(generation>0),
  intent_id uuid not null references public.m4_output_intents(intent_id),
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  check(deadline_at = created_at + interval '15 seconds')
);
alter table public.game_completion_closing enable row level security;
revoke all on public.game_completion_closing from public,anon,authenticated,service_role;

create function public.complete_reviewed_game_with_closing(
  p_game_id uuid,p_review_id uuid,p_completion_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_closing jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_desktop public.m4_desktop_sessions; v_output public.m4_output_intents;
  v_broadcast public.broadcast_sessions; v_completion record; v_grant public.game_completion_closing; v_created_at timestamptz;
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  perform 1 from public.authorize_game_completion_actor(p_game_id,p_actor_user_id,p_verified_organizer);
  -- Legitimate retries return the original grant, never create or extend one.
  if not exists(select 1 from public.game_completions where game_id=p_game_id) then
    if p_closing->>'capability' is distinct from 'final-card-v1' then raise exception 'closing capability required' using errcode='22023'; end if;
    select * into v_broadcast from public.broadcast_sessions where game_id=p_game_id and provider='youtube' for update;
    select * into v_desktop from public.m4_desktop_sessions where game_id=p_game_id and session_id=(p_closing->>'sessionId')::uuid for update;
    select * into v_output from public.m4_output_intents where game_id=p_game_id and intent_id=(p_closing->>'intentId')::uuid for update;
    if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is not null or v_game.status<>'active'
      or (select state->>'status' from public.game_states where game_id=p_game_id) is distinct from 'active'
      or v_desktop.session_id is null or v_desktop.organization_id<>v_game.organization_id or v_desktop.status<>'active'
      or v_desktop.generation is distinct from (p_closing->>'generation')::bigint
      or v_desktop.expires_at is null or v_desktop.expires_at<=clock_timestamp()+interval '15 seconds'
      or v_desktop.lease_expires_at is null or v_desktop.lease_expires_at<=clock_timestamp()
      or v_desktop.generation<>(select max(generation) from public.m4_desktop_sessions where game_id=p_game_id)
      or v_output.intent_id is null or v_output.organization_id<>v_game.organization_id
      or v_output.session_id<>v_desktop.session_id or v_output.generation<>v_desktop.generation
      or v_output.delivery_recorded_at is null or v_output.phase<>'quarantined'
      or v_broadcast.id is null or v_broadcast.organization_id<>v_game.organization_id
      or v_broadcast.transport<>'local-obs' or v_broadcast.desired_state<>'live'
      or v_broadcast.status not in ('prepared','live') or v_broadcast.uncertain_since is not null
      or v_output.broadcast_generation<>v_broadcast.operation_generation
      or v_output.youtube_broadcast_id is distinct from v_broadcast.youtube_broadcast_id
      or v_output.youtube_stream_id is distinct from v_broadcast.youtube_stream_id
    then raise exception 'closing output unavailable' using errcode='55000'; end if;
    if v_desktop.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_desktop.approved_by,false); end if;
    v_created_at:=clock_timestamp();
    insert into public.game_completion_closing(game_id,session_id,generation,intent_id,created_at,deadline_at)
      values(p_game_id,v_desktop.session_id,v_desktop.generation,v_output.intent_id,v_created_at,v_created_at+interval '15 seconds');
    update public.m4_desktop_sessions set lease_expires_at=least(expires_at,v_created_at+interval '15 seconds') where session_id=v_desktop.session_id;
  end if;
  -- Revision conflict rolls back both the lease and grant in this transaction.
  select * into v_completion from public.complete_reviewed_game(p_game_id,p_review_id,p_completion_id,p_actor_user_id,p_verified_organizer);
  select * into v_grant from public.game_completion_closing where game_id=p_game_id;
  return to_jsonb(v_completion) || jsonb_build_object('closing',case when v_grant.game_id is null then null else
    jsonb_build_object('sessionId',v_grant.session_id,'generation',v_grant.generation,'intentId',v_grant.intent_id,'deadlineAt',v_grant.deadline_at) end);
end $$;

-- The broadcast journal has its own terminal fence. Preserve exactly the
-- delivered local output named by the same closing grant; all other broadcasts
-- and every deletion keep the original immediate stop/generation fence.
create or replace function public.fence_terminal_game_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if (old.completed_at is null and new.completed_at is not null)
    or (old.deleted_at is null and new.deleted_at is not null) then
    update public.broadcast_sessions b set desired_state='stopped',
      status=case when b.status in ('idle','stopped') then 'stopped' else 'stopping' end,
      operation_generation=b.operation_generation+1,
      operation_token=null,lease_expires_at=null,updated_at=now()
    where b.game_id=new.id and b.provider='youtube' and not (
      old.completed_at is null and new.completed_at is not null and new.status='completed'
      and new.deleted_at is null and b.organization_id=new.organization_id and b.transport='local-obs' and b.desired_state='live'
      and b.status in ('prepared','live') and exists (
        select 1 from public.game_completion_closing c
        join public.m4_desktop_sessions s on s.session_id=c.session_id and s.game_id=c.game_id and s.generation=c.generation
        join public.m4_output_intents i on i.intent_id=c.intent_id and i.game_id=c.game_id and i.session_id=c.session_id and i.generation=c.generation
        where c.game_id=new.id and c.deadline_at>clock_timestamp()
          and s.organization_id=new.organization_id and s.status='active' and s.revoked_at is null
          and s.expires_at>clock_timestamp() and s.lease_expires_at>clock_timestamp()
          and s.generation=(select max(generation) from public.m4_desktop_sessions where game_id=new.id)
          and i.organization_id=new.organization_id and i.phase='quarantined' and i.delivery_recorded_at is not null
          and i.broadcast_generation=b.operation_generation
          and i.youtube_broadcast_id is not distinct from b.youtube_broadcast_id
          and i.youtube_stream_id is not distinct from b.youtube_stream_id
      )
    );
  end if;
  return new;
end $$;

create or replace function public.fence_terminal_m4_desktop() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null or new.completed_at is not null or new.status<>'active' then
    update public.m4_desktop_sessions s set status='revoked',revoked_at=coalesce(s.revoked_at,now())
    where s.game_id=new.id and s.status in ('pending','active') and not (
      new.deleted_at is null and new.status='completed' and new.completed_at is not null
      and exists(select 1 from public.game_completion_closing c where c.game_id=new.id and c.session_id=s.session_id and c.generation=s.generation and c.deadline_at>now())
    );
  end if;
  return new;
end $$;
create or replace function public.fence_terminal_m4_output() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.deleted_at is not null or new.completed_at is not null or new.status<>'active' then
    update public.m4_output_intents i set phase='stop_requested' where i.game_id=new.id and not (
      new.deleted_at is null and new.status='completed' and new.completed_at is not null
      and exists(select 1 from public.game_completion_closing c where c.game_id=new.id and c.intent_id=i.intent_id and c.session_id=i.session_id and c.generation=i.generation and c.deadline_at>now())
    );
  end if;
  return new;
end $$;

-- Provider teardown may run early only after native authenticated Stop or revocation.
create function public.game_completion_cleanup_ready(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_grant public.game_completion_closing; v_desktop public.m4_desktop_sessions; v_game public.games;
begin
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  perform 1 from public.authorize_game_completion_actor(p_game_id,p_actor_user_id,p_verified_organizer);
  if not exists(select 1 from public.game_completions where game_id=p_game_id) then raise exception 'completion required' using errcode='55000'; end if;
  select * into v_grant from public.game_completion_closing where game_id=p_game_id;
  if v_grant.game_id is null then return true; end if;
  select * into v_desktop from public.m4_desktop_sessions where session_id=v_grant.session_id for update;
  if v_grant.deadline_at>now() and v_game.deleted_at is null and v_desktop.status='active'
    and not exists(select 1 from public.m4_output_intents where intent_id=v_grant.intent_id and phase='stop_requested') then return false; end if;
  update public.m4_desktop_sessions set status=case when status='stopped' then 'stopped' else 'revoked' end,revoked_at=coalesce(revoked_at,now()) where session_id=v_grant.session_id;
  update public.m4_output_intents set phase='stop_requested' where game_id=p_game_id;
  return true;
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
    update public.m4_desktop_sessions s set lease_expires_at=least(s.expires_at,case when v_closing_valid then v_closing.deadline_at else now()+interval '30 seconds' end) where s.session_id=v_row.session_id returning * into v_row;
  else raise exception 'desktop not active' using errcode='42501'; end if;
  return query select v_row.session_id,v_row.generation,v_row.expires_at,v_row.lease_expires_at,case when p_stop or v_terminal or v_row.status<>'active' then 'stop' else 'wait' end;
end $$;

-- Read only: an existing desktop bearer may recover its closing grant after
-- terminal /program rejection. This grants no camera or target authority.
create function public.read_m4_completion_closing(p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text)
returns table(session_id uuid,generation bigint,intent_id uuid,deadline_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_game public.games; v_desktop public.m4_desktop_sessions; v_grant public.game_completion_closing; v_completion public.game_completions;
begin
  if p_bearer_hash is null or p_bearer_hash !~ '^[0-9a-f]{64}$' or p_generation is null or p_generation<=0 then raise exception 'closing authority denied' using errcode='42501'; end if;
  perform 1 from public.game_states where game_id=p_game_id for update;
  select * into v_game from public.games where id=p_game_id for update;
  select * into v_desktop from public.m4_desktop_sessions s where s.game_id=p_game_id and s.session_id=p_session_id for update;
  select * into v_grant from public.game_completion_closing where game_id=p_game_id;
  select * into v_completion from public.game_completions where game_id=p_game_id;
  if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is null or v_game.status<>'completed'
    or v_completion.game_id is null
    or v_desktop.session_id is null or v_desktop.organization_id<>v_game.organization_id
    or v_desktop.generation<>p_generation or v_desktop.bearer_hash is distinct from p_bearer_hash
    or v_desktop.status<>'active' or v_desktop.revoked_at is not null
    or v_desktop.expires_at is null or v_desktop.expires_at<=clock_timestamp()
    or v_desktop.lease_expires_at is null or v_desktop.lease_expires_at<=clock_timestamp()
    or v_grant.game_id is null or v_grant.session_id<>p_session_id or v_grant.generation<>p_generation
    or v_grant.deadline_at<=clock_timestamp()
    or not exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id and i.intent_id=v_grant.intent_id
      and i.organization_id=v_game.organization_id and i.session_id=p_session_id and i.generation=p_generation
      and i.phase='quarantined' and i.delivery_recorded_at is not null)
    or exists(select 1 from public.broadcast_sessions b where b.game_id=p_game_id and b.provider='youtube' and b.desired_state='stopped')
  then raise exception 'closing authority denied' using errcode='42501'; end if;
  if v_desktop.approved_by is not null then perform 1 from public.authorize_game_broadcast_actor(p_game_id,v_desktop.approved_by,false); end if;
  if v_completion.completed_by_kind='account' then perform 1 from public.authorize_game_completion_actor(p_game_id,v_completion.completed_by_user_id,false); end if;
  if v_grant.deadline_at<=clock_timestamp() then raise exception 'closing authority expired' using errcode='42501'; end if;
  return query select v_grant.session_id,v_grant.generation,v_grant.intent_id,v_grant.deadline_at;
end $$;
revoke all on function public.read_m4_completion_closing(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.read_m4_completion_closing(uuid,uuid,bigint,text) to service_role;

revoke all on function public.complete_reviewed_game_with_closing(uuid,uuid,uuid,uuid,boolean,jsonb),public.game_completion_cleanup_ready(uuid,uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.complete_reviewed_game_with_closing(uuid,uuid,uuid,uuid,boolean,jsonb),public.game_completion_cleanup_ready(uuid,uuid,boolean) to service_role;
notify pgrst,'reload schema';
