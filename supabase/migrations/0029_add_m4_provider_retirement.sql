-- Service-side evidence only: existing delivery barriers remain sticky.
-- The caller must authoritatively verify broadcast terminal/absent AND stream
-- absent before invoking this RPC. Browser/desktop acknowledgments are not proof.
create table public.m4_provider_retirements (
  retirement_id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  organization_id uuid not null references public.organizations(id),
  broadcast_generation bigint not null,
  operation_token uuid not null,
  youtube_broadcast_id text,
  youtube_stream_id text,
  youtube_channel_id text not null,
  confirmed_by uuid references auth.users(id),
  confirmed_at timestamptz not null default clock_timestamp(),
  check(youtube_broadcast_id is not null or youtube_stream_id is not null),
  unique(game_id,broadcast_generation)
);
alter table public.m4_provider_retirements enable row level security;
revoke all on public.m4_provider_retirements from public,anon,authenticated,service_role;
alter table public.m4_output_intents add column provider_retirement_id uuid references public.m4_provider_retirements(retirement_id);

create function public.confirm_m4_provider_retirement(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_generation bigint,p_operation_token uuid,p_youtube_broadcast_id text,p_youtube_stream_id text,p_youtube_channel_id text,p_connection_version bigint,p_encrypted_credentials text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_b public.broadcast_sessions; v_r public.m4_provider_retirements; v_result jsonb; v_c public.broadcast_settings;
begin
  if p_generation is null or p_generation<=0 or p_operation_token is null
    or p_connection_version is null or p_connection_version<0 or p_encrypted_credentials is null
    or (p_youtube_broadcast_id is null and p_youtube_stream_id is null)
    or p_youtube_broadcast_id='' or p_youtube_stream_id='' or nullif(p_youtube_channel_id,'') is null
    then raise exception 'invalid retirement evidence' using errcode='22023'; end if;
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  select * into v_b from public.broadcast_sessions where game_id=p_game_id and provider='youtube';
  -- Follow authority lock order: desktops precede intents.
  perform 1 from public.m4_desktop_sessions where game_id=p_game_id order by session_id for update;
  perform 1 from public.m4_output_intents where game_id=p_game_id order by intent_id for update;
  select * into v_c from public.broadcast_settings where organization_id=v_b.organization_id and provider='youtube' for update;
  if v_c.organization_id is null or v_c.connection_status<>'connected' or v_c.channel_id is distinct from p_youtube_channel_id
    or v_c.connection_version is distinct from p_connection_version or encode(v_c.encrypted_credentials,'base64') is distinct from p_encrypted_credentials
    then raise exception 'retirement credentials changed' using errcode='55000'; end if;
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if v_b.id is null or v_b.transport<>'local-obs' or v_b.desired_state<>'stopped' or v_b.status<>'stopping'
    or v_b.operation_generation is distinct from p_generation or v_b.operation_token is distinct from p_operation_token
    or v_b.lease_expires_at is null or v_b.lease_expires_at<=clock_timestamp()
    or v_b.youtube_broadcast_id is distinct from p_youtube_broadcast_id or v_b.youtube_stream_id is distinct from p_youtube_stream_id
    or v_b.youtube_channel_id is distinct from p_youtube_channel_id
    then raise exception 'retirement operation fenced' using errcode='55000'; end if;
  if exists(select 1 from public.m4_output_intents where game_id=p_game_id and delivery_recorded_at is not null
    and youtube_broadcast_id is not distinct from p_youtube_broadcast_id and youtube_stream_id is not distinct from p_youtube_stream_id
    and delivery_channel_id is not null and delivery_channel_id is distinct from p_youtube_channel_id)
    then raise exception 'retirement delivery channel mismatch' using errcode='55000'; end if;
  insert into public.m4_provider_retirements(game_id,organization_id,broadcast_generation,operation_token,youtube_broadcast_id,youtube_stream_id,youtube_channel_id,confirmed_by)
    values(p_game_id,v_b.organization_id,p_generation,p_operation_token,p_youtube_broadcast_id,p_youtube_stream_id,p_youtube_channel_id,p_actor_user_id) returning * into v_r;
  update public.m4_output_intents set provider_retirement_id=v_r.retirement_id,phase='stop_requested'
    where game_id=p_game_id and organization_id=v_b.organization_id
      and youtube_broadcast_id is not distinct from p_youtube_broadcast_id and youtube_stream_id is not distinct from p_youtube_stream_id
      and broadcast_generation<=p_generation and provider_retirement_id is null;
  update public.m4_desktop_sessions set status='revoked',revoked_at=coalesce(revoked_at,clock_timestamp())
    where game_id=p_game_id and status in ('pending','active');
  v_result:=public.record_m4_broadcast_operation(p_game_id,p_generation,p_operation_token,'stopped',p_provider_step=>'m4-provider-retired');
  if v_result is null then raise exception 'retirement operation fenced' using errcode='55000'; end if;
  return v_result;
end $$;
revoke all on function public.confirm_m4_provider_retirement(uuid,uuid,boolean,bigint,uuid,text,text,text,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_m4_provider_retirement(uuid,uuid,boolean,bigint,uuid,text,text,text,bigint,text) to service_role;
-- No existing claim/consume barrier is relaxed. Evidence is retained for a later
-- audited replacement protocol; stopped/expired clients cannot reuse a target.
notify pgrst,'reload schema';
