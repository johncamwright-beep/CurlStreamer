-- A scheduled watch page is a durable game attribute. Provider work happens
-- after game creation; this journal lets a retry adopt the same YouTube item.
begin;

alter table public.games
  add column youtube_scheduled_broadcast_id text,
  add column youtube_scheduled_watch_url text
    check (youtube_scheduled_watch_url is null or public.is_valid_youtube_watch_url(youtube_scheduled_watch_url)),
  add column youtube_scheduled_status text not null default 'none'
    check (youtube_scheduled_status in ('none','pending','intent','ready','failed')),
  add column youtube_scheduled_error_code text,
  add column youtube_scheduled_channel_id text,
  add column youtube_scheduled_connection_version bigint,
  add column youtube_scheduled_updated_at timestamptz;

-- Creating the game is transactional even when YouTube is unavailable. The
-- game UUID is the provider marker/session key, so retries discover rather
-- than duplicate a provider resource.
create or replace function public.create_scheduled_team_game(
 p_user_id uuid,p_game_id uuid,p_season_id uuid,p_event_id uuid,p_opponent_id uuid,
 p_scheduled_start timestamptz,p_timezone text,p_game_number integer,p_game_label text,p_config jsonb,p_state jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_existing uuid; v_youtube boolean:=coalesce((p_config->>'youtubeEnabled')::boolean,false);
begin
 perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,9));
 if p_scheduled_start is null or (p_event_id is not null and p_game_number<=0)
   or (p_event_id is null and p_game_number is not null) then raise exception 'invalid_schedule' using errcode='22023'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
 if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then raise exception 'season_unavailable' using errcode='23514'; end if;
 if p_event_id is not null and not exists(select 1 from public.events where id=p_event_id and season_id=p_season_id and organization_id=v_org and archived_at is null) then raise exception 'event_unavailable' using errcode='23514'; end if;
 if p_opponent_id is not null and not exists(select 1 from public.opponents where id=p_opponent_id and organization_id=v_org and archived_at is null) then raise exception 'opponent_unavailable' using errcode='23514'; end if;
 select organization_id into v_existing from public.games where id=p_game_id;
 if found then
   if v_existing<>v_org then raise exception 'identifier_conflict' using errcode='23505'; end if;
   if not exists(select 1 from public.game_states where game_id=p_game_id) then raise exception 'incomplete_game' using errcode='23514'; end if;
   return;
 end if;
 if v_youtube and (p_config->>'youtubeVisibility' is distinct from 'unlisted') then raise exception 'scheduled youtube requires unlisted visibility' using errcode='22023'; end if;
 insert into public.organizer_users(organization_id,user_id) values(v_org,p_user_id) on conflict do nothing;
 insert into public.games(id,organization_id,config,status,created_by,season_id,event_id,opponent_id,scheduled_start,schedule_timezone,game_number,game_label,youtube_scheduled_status,youtube_scheduled_updated_at)
 values(p_game_id,v_org,p_config,'active',p_user_id,p_season_id,p_event_id,p_opponent_id,p_scheduled_start,p_timezone,p_game_number,nullif(btrim(p_game_label),''),case when v_youtube then 'pending' else 'none' end,case when v_youtube then now() else null end);
 insert into public.game_states(game_id,state) values(p_game_id,p_state);
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'game.created','game',p_game_id::text,jsonb_build_object('source',case when p_event_id is null then 'single_game' else 'scheduled_event' end,'season_id',p_season_id,'event_id',p_event_id,'opponent_id',p_opponent_id,'youtube_requested',v_youtube));
end $$;

-- This RPC also makes failed attempts visible without exposing credentials or
-- any stream key. A ready value is immutable: retries may rediscover it but
-- cannot replace it with another provider broadcast.
create function public.claim_scheduled_youtube_broadcast(p_user_id uuid,p_game_id uuid)
returns table(action text,status text,watch_url text) language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_game public.games;
begin
 select * into v_game from public.games where id=p_game_id and organization_id=v_org and deleted_at is null for update;
 if not found then raise exception 'game unavailable' using errcode='42501'; end if;
 if v_game.completed_at is not null or v_game.status<>'active' then raise exception 'terminal game' using errcode='55000'; end if;
 if not coalesce((v_game.config->>'youtubeEnabled')::boolean,false) then raise exception 'youtube not requested' using errcode='22023'; end if;
 if v_game.youtube_scheduled_status='ready' then return query select 'none'::text,'ready'::text,v_game.youtube_scheduled_watch_url; return; end if;
 if v_game.youtube_scheduled_status='intent' then return query select 'discover'::text,'intent'::text,null::text; return; end if;
 update public.games set youtube_scheduled_status='intent',youtube_scheduled_error_code=null,youtube_scheduled_updated_at=now() where id=p_game_id;
 return query select 'run'::text,'intent'::text,null::text;
end $$;

create function public.record_scheduled_youtube_broadcast(
 p_user_id uuid,p_game_id uuid,p_broadcast_id text default null,p_watch_url text default null,p_error_code text default null,p_channel_id text default null,p_connection_version bigint default null)
returns table(status text,watch_url text) language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_game public.games;
begin
 select * into v_game from public.games where id=p_game_id and organization_id=v_org and deleted_at is null for update;
 if not found then raise exception 'game unavailable' using errcode='42501'; end if;
 if v_game.completed_at is not null or v_game.status<>'active' then raise exception 'terminal game' using errcode='55000'; end if;
 if not coalesce((v_game.config->>'youtubeEnabled')::boolean,false) then raise exception 'youtube not requested' using errcode='22023'; end if;
 if v_game.youtube_scheduled_status='ready' then
   return query select v_game.youtube_scheduled_status,v_game.youtube_scheduled_watch_url; return;
 end if;
 if p_broadcast_id is not null and public.is_valid_youtube_watch_url(p_watch_url) then
   if p_channel_id is null or p_connection_version is null or p_connection_version<=0 then raise exception 'scheduled youtube connection required' using errcode='22023'; end if;
   update public.games set youtube_scheduled_broadcast_id=p_broadcast_id,youtube_scheduled_watch_url=p_watch_url,youtube_scheduled_status='ready',youtube_scheduled_error_code=null,youtube_scheduled_channel_id=p_channel_id,youtube_scheduled_connection_version=p_connection_version,youtube_scheduled_updated_at=now() where id=p_game_id;
   insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user_id,v_org,'game.youtube_scheduled','game',p_game_id::text,jsonb_build_object('broadcast_id',p_broadcast_id));
   return query select 'ready'::text,p_watch_url; return;
 end if;
 if p_error_code is null then raise exception 'scheduled youtube result required' using errcode='22023'; end if;
 -- An error after a durable creation claim may follow a successful provider
 -- insert whose response/persistence was lost. Keep intent discover-only.
 update public.games set youtube_scheduled_status='intent',youtube_scheduled_error_code=left(p_error_code,160),youtube_scheduled_updated_at=now() where id=p_game_id;
 return query select 'intent'::text,null::text;
end $$;

-- Every transport adopts the scheduled event at its first session insert.
-- It never changes an existing session, so a running broadcast cannot be
-- redirected or stopped by a game-setup retry.
create function public.adopt_scheduled_youtube_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_game public.games;
begin
 if new.provider='youtube' then
   select * into v_game from public.games where id=new.game_id;
   if v_game.youtube_scheduled_status='intent' and v_game.youtube_scheduled_updated_at > now()-interval '30 seconds' then
     raise exception 'YouTube scheduling is still settling; retry shortly' using errcode='55000';
   end if;
   if coalesce((v_game.config->>'youtubeEnabled')::boolean,false) then
     new.session_key:=new.game_id;
     new.youtube_broadcast_create_state:='intent';
     -- Pending means preflight never reached YouTube: Stop is a no-op. An
     -- actual provider intent (or ready item) must enter cleanup on Stop.
     if v_game.youtube_scheduled_status in ('intent','ready') then
       new.desired_state:='live';
       new.status:='preparing';
     end if;
   end if;
   if v_game.youtube_scheduled_status='ready' and v_game.youtube_scheduled_broadcast_id is not null then
     new.youtube_broadcast_id:=v_game.youtube_scheduled_broadcast_id;
     new.provider_session_id:=v_game.youtube_scheduled_broadcast_id;
     new.watch_url:=v_game.youtube_scheduled_watch_url;
     new.youtube_broadcast_create_state:='ready';
     new.youtube_channel_id:=v_game.youtube_scheduled_channel_id;
     new.youtube_connection_version:=v_game.youtube_scheduled_connection_version;
   end if;
 end if;
 return new;
end $$;
create trigger adopt_scheduled_youtube_broadcast_before_session_insert
before insert on public.broadcast_sessions for each row execute function public.adopt_scheduled_youtube_broadcast();

-- Pending scheduled games use the game id as the discovery marker, which is
-- also the marker the adoption trigger assigns to the later Studio session.
drop function public.list_team_hierarchy_games(uuid);
create function public.list_team_hierarchy_games(p_user_id uuid)
returns table(id uuid,season_id uuid,event_id uuid,opponent_id uuid,scheduled_start timestamptz,schedule_timezone text,game_number integer,game_label text,created_at timestamptz,game_status text,config jsonb,youtube_scheduled_watch_url text,youtube_scheduled_status text)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select g.id,g.season_id,g.event_id,g.opponent_id,g.scheduled_start,g.schedule_timezone,g.game_number,g.game_label,g.created_at,coalesce(gs.state->>'status',g.status),g.config,g.youtube_scheduled_watch_url,g.youtube_scheduled_status from public.games g left join public.game_states gs on gs.game_id=g.id where g.organization_id=v_org and g.deleted_at is null order by g.scheduled_start asc nulls last,g.created_at desc,g.id; end $$;

-- Upcoming public games can expose an opt-in scheduled watch page; completed
-- games still prefer the authoritative completion/replay URL.
create or replace function public.read_public_team_games(p_org uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) from (
 select coalesce(c.completed_at,g.scheduled_start,g.created_at) stamp, jsonb_build_object(
 'id',g.id,'event',g.config->>'eventName','home',g.config->>'homeName','away',g.config->>'awayName',
 'number',g.game_number,'scheduled',g.scheduled_start,'completed',c.completed_at,
 'result',c.result->'totals','youtube',case when c.game_id is not null then c.youtube_watch_url else g.youtube_scheduled_watch_url end) item
 from public.games g left join public.game_completions c on c.game_id=g.id
 join public.team_public_profiles p on p.organization_id=g.organization_id
 where g.organization_id=p_org and g.deleted_at is null and p.settings->>'published'='true'
 and ((c.game_id is not null and p.settings->>'results'='true') or
 (c.game_id is null and g.scheduled_start>=now()-interval '1 day' and p.settings->>'upcoming'='true'))
 order by coalesce(c.completed_at,g.scheduled_start,g.created_at) desc limit 100) rows;
$$;

revoke all on function public.list_team_hierarchy_games(uuid),public.claim_scheduled_youtube_broadcast(uuid,uuid),public.record_scheduled_youtube_broadcast(uuid,uuid,text,text,text,text,bigint),public.adopt_scheduled_youtube_broadcast() from public,anon,authenticated,service_role;
grant execute on function public.list_team_hierarchy_games(uuid),public.claim_scheduled_youtube_broadcast(uuid,uuid),public.record_scheduled_youtube_broadcast(uuid,uuid,text,text,text,text,bigint) to service_role;
notify pgrst,'reload schema';
commit;
