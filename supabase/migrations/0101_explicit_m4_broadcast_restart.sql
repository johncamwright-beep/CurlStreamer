begin;

-- Only the server may use this after verifying the original provider binding.
-- Separate cleanup from replacement so an interrupted request can safely retry.
create function public.claim_m4_broadcast_restart(
  p_game_id uuid,
  p_actor_user_id uuid,
  p_verified_organizer boolean,
  p_generation bigint,
  p_youtube_broadcast_id text,
  p_operation_token uuid,
  p_connection_version bigint,
  p_encrypted_credentials text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_game public.games;
  v_broadcast public.broadcast_sessions;
  v_connection public.broadcast_settings;
begin
  if p_generation is null or p_generation <= 0
    or nullif(p_youtube_broadcast_id, '') is null or p_operation_token is null
    or ((p_connection_version is null) <> (p_encrypted_credentials is null))
  then raise exception 'invalid restart claim' using errcode = '22023'; end if;

  perform public.lock_broadcast_transport(p_game_id, 'local-obs');
  perform 1 from public.authorize_game_broadcast_actor(
    p_game_id, p_actor_user_id, coalesce(p_verified_organizer, false));
  select * into v_game from public.games where id = p_game_id;
  select * into v_broadcast from public.broadcast_sessions
    where game_id = p_game_id and provider = 'youtube';
  if v_game.id is null or v_game.deleted_at is not null or v_game.completed_at is not null
    or v_game.status <> 'active'
    or (select state->>'status' from public.game_states where game_id = p_game_id) is distinct from 'active'
    or coalesce(v_game.config->>'youtubeVisibility', '') not in ('unlisted', 'public', 'private')
    or v_broadcast.id is null or v_broadcast.organization_id <> v_game.organization_id
    or v_broadcast.operation_generation is distinct from p_generation
    or v_broadcast.youtube_broadcast_id is distinct from p_youtube_broadcast_id
    or v_broadcast.watch_url is null
    or v_broadcast.lease_expires_at > clock_timestamp()
  then raise exception 'broadcast restart fenced' using errcode = '55000'; end if;

  perform public.assert_team_broadcast_access(v_game.organization_id);
  if p_connection_version is null then
    -- This archives the old recording and requires confirmed retirement of its
    -- exact broadcast and stream before releasing any desktop delivery barrier.
    return public.begin_m4_replacement_cycle(
      p_game_id, p_actor_user_id, p_verified_organizer, p_operation_token);
  end if;
  if v_broadcast.status = 'stopped' and v_broadcast.provider_step = 'm4-provider-retired' then
    raise exception 'broadcast retirement already confirmed' using errcode = '55000';
  end if;

  -- The server just observed the saved broadcast on this connection. Discard
  -- that evidence if the credentials changed while YouTube was being queried.
  select * into v_connection from public.broadcast_settings
    where organization_id = v_game.organization_id and provider = 'youtube' for update;
  perform 1 from public.authorize_game_broadcast_actor(
    p_game_id, p_actor_user_id, coalesce(p_verified_organizer, false));
  if v_connection.organization_id is null or v_connection.connection_status <> 'connected'
    or v_connection.channel_id is null
    or v_connection.channel_id is distinct from v_broadcast.youtube_channel_id
    or v_connection.connection_version is distinct from p_connection_version
    or encode(v_connection.encrypted_credentials, 'base64') is distinct from p_encrypted_credentials
  then raise exception 'restart credentials changed' using errcode = '55000'; end if;

  update public.broadcast_sessions set
    desired_state = 'stopped', status = 'stopping',
    operation_generation = operation_generation + 1, operation_token = p_operation_token,
    lease_expires_at = clock_timestamp() + interval '30 seconds',
    last_attempted_at = clock_timestamp(), updated_at = clock_timestamp(), last_error_code = null
  where id = v_broadcast.id returning * into v_broadcast;
  return public.broadcast_session_json(
    v_broadcast, 'run', v_game.config, v_connection.encrypted_credentials,
    v_connection.channel_id, v_connection.connection_version
  ) || jsonb_build_object('transport', 'local-obs');
end;
$$;

revoke all on function public.claim_m4_broadcast_restart(uuid, uuid, boolean, bigint, text, uuid, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_m4_broadcast_restart(uuid, uuid, boolean, bigint, text, uuid, bigint, text)
  to service_role;

-- Keep the original scheduling record. Once its replacement is ready, the
-- public game listing follows the current watch page for the same Public game.
create or replace function public.read_public_team_games(p_org uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) from (
 select coalesce(c.completed_at,g.scheduled_start,g.created_at) stamp, jsonb_build_object(
 'id',g.id,'event_id',e.id,'event',e.name,'home',g.config->>'homeName','away',g.config->>'awayName',
 'opponent_slug',op.slug,'opponent_logo',op.logo_url,
 'number',g.game_number,'scheduled',g.scheduled_start,'timezone',coalesce(g.schedule_timezone,e.timezone),'completed',c.completed_at,
 'result',public.current_game_completion_result(c.game_id)->'totals',
 'youtube',case when g.config->>'youtubeVisibility'='public' then
   case
     when c.game_id is null and g.youtube_scheduled_status='ready' then coalesce((
       select s.watch_url from public.broadcast_sessions s
       where s.game_id=g.id and s.organization_id=g.organization_id and s.provider='youtube'
         and s.transport='local-obs' and s.status in ('prepared','live','stopping','stopped')
         and exists (
           select 1 from public.m4_broadcast_cycle_history h
           join public.m4_provider_retirements r on r.retirement_id=h.retirement_id
             and r.game_id=h.game_id and r.organization_id=h.organization_id
           where h.game_id=g.id and h.organization_id=g.organization_id
             and r.youtube_broadcast_id=g.youtube_scheduled_broadcast_id
         )
     ),g.youtube_scheduled_watch_url)
     when c.game_id is not null and (
       (g.youtube_scheduled_status='ready' and c.youtube_watch_url=g.youtube_scheduled_watch_url)
       or exists (
         select 1 from public.broadcast_sessions s
         where s.game_id=g.id and s.organization_id=g.organization_id and s.provider='youtube'
           and s.started_at is not null and s.watch_url=c.youtube_watch_url
       )
     ) then c.youtube_watch_url
   end
 end) item
 from public.games g left join public.game_completions c on c.game_id=g.id
 left join public.events e on e.id=g.event_id and e.organization_id=g.organization_id
 left join public.opponents o on o.id=g.opponent_id and o.organization_id=g.organization_id
 left join public.team_public_profiles op on op.organization_id=o.linked_organization_id and op.settings->>'published'='true'
 join public.team_public_profiles p on p.organization_id=g.organization_id
 where g.organization_id=p_org and g.deleted_at is null and p.settings->>'published'='true'
 and ((c.game_id is not null and p.settings->>'results'='true') or
 (c.game_id is null and g.scheduled_start>=now()-interval '1 day' and p.settings->>'upcoming'='true'))
 order by coalesce(c.completed_at,g.scheduled_start,g.created_at) desc limit 100) rows;
$$;

notify pgrst, 'reload schema';
commit;
