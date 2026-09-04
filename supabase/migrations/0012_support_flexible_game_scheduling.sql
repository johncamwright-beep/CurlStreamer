-- Flexible scheduling follows 0011. The original create_scheduled_team_game
-- signature is intentionally retained for deployed clients.
alter type public.event_type add value if not exists 'playoff';
alter table public.games add column schedule_timezone text
  check (schedule_timezone is null or length(btrim(schedule_timezone)) between 1 and 100);

create function public.create_scheduled_team_game(
 p_user_id uuid,p_game_id uuid,p_season_id uuid,p_event_id uuid,p_opponent_id uuid,
 p_scheduled_start timestamptz,p_timezone text,p_game_number integer,p_game_label text,p_config jsonb,p_state jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_existing uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,9));
 if p_scheduled_start is null or (p_event_id is not null and (p_game_number is null or p_game_number<=0))
   or (p_event_id is null and p_game_number is not null) then
   raise exception 'invalid_schedule' using errcode='22023';
 end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
 if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then
   raise exception 'season_unavailable' using errcode='23514'; end if;
 if p_event_id is not null and not exists(select 1 from public.events where id=p_event_id and season_id=p_season_id and organization_id=v_org and archived_at is null) then
   raise exception 'event_unavailable' using errcode='23514'; end if;
 if p_opponent_id is not null and not exists(select 1 from public.opponents where id=p_opponent_id and organization_id=v_org and archived_at is null) then
   raise exception 'opponent_unavailable' using errcode='23514'; end if;
 select organization_id into v_existing from public.games where id=p_game_id;
 if found then
   if v_existing<>v_org then raise exception 'identifier_conflict' using errcode='23505'; end if;
   if not exists(select 1 from public.game_states where game_id=p_game_id) then raise exception 'incomplete_game' using errcode='23514'; end if;
   return;
 end if;
 insert into public.organizer_users(organization_id,user_id) values(v_org,p_user_id) on conflict do nothing;
 insert into public.games(id,organization_id,config,status,created_by,season_id,event_id,opponent_id,scheduled_start,schedule_timezone,game_number,game_label)
 values(p_game_id,v_org,p_config,'active',p_user_id,p_season_id,p_event_id,p_opponent_id,p_scheduled_start,p_timezone,p_game_number,nullif(btrim(p_game_label),''));
 insert into public.game_states(game_id,state) values(p_game_id,p_state);
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'game.created','game',p_game_id::text,jsonb_build_object('source',case when p_event_id is null then 'single_game' else 'scheduled_event' end,'season_id',p_season_id,'event_id',p_event_id,'opponent_id',p_opponent_id));
end $$;

create function public.update_scheduled_team_game(
 p_user_id uuid,p_game_id uuid,p_season_id uuid,p_event_id uuid,p_opponent_id uuid,
 p_scheduled_start timestamptz,p_timezone text,p_game_number integer,p_game_label text)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_old_opponent uuid; v_old_config jsonb; v_away text; v_event_name text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,9));
 if p_scheduled_start is null or (p_event_id is not null and (p_game_number is null or p_game_number<=0))
   or (p_event_id is null and p_game_number is not null) then raise exception 'invalid_schedule' using errcode='22023'; end if;
 if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'invalid_timezone' using errcode='22023'; end if;
 if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then raise exception 'season_unavailable' using errcode='23514'; end if;
 if p_event_id is not null and not exists(select 1 from public.events where id=p_event_id and season_id=p_season_id and organization_id=v_org and archived_at is null) then raise exception 'event_unavailable' using errcode='23514'; end if;
 if p_event_id is not null then select name into v_event_name from public.events where id=p_event_id; end if;
 if p_opponent_id is not null then
   select display_name into v_away from public.opponents where id=p_opponent_id and organization_id=v_org and archived_at is null;
   if not found then raise exception 'opponent_unavailable' using errcode='23514'; end if;
 else v_away:='Opponent TBD'; end if;
 v_event_name:=coalesce(nullif(btrim(p_game_label),''),case when p_event_id is null then v_away||' — '||p_scheduled_start::date else v_event_name||' — Game '||p_game_number end);
 select opponent_id,config into v_old_opponent,v_old_config from public.games where id=p_game_id and organization_id=v_org and deleted_at is null for update;
 if not found then raise exception 'game_unavailable' using errcode='42501'; end if;
 -- Participant identity becomes immutable after the first scored end; hammer selection alone is safe.
 if v_old_opponent is distinct from p_opponent_id and exists(select 1 from public.score_events where game_id=p_game_id and event_type='end') then
   raise exception 'participant_locked' using errcode='23514'; end if;
 update public.games set season_id=p_season_id,event_id=p_event_id,opponent_id=p_opponent_id,
   scheduled_start=p_scheduled_start,schedule_timezone=p_timezone,game_number=p_game_number,game_label=nullif(btrim(p_game_label),''),
   config=jsonb_set(jsonb_set(config,'{awayName}',to_jsonb(v_away),true),'{eventName}',to_jsonb(v_event_name),true)
 where id=p_game_id;
 update public.game_states set state=jsonb_set(jsonb_set(state,'{config,awayName}',to_jsonb(v_away),true),'{config,eventName}',to_jsonb(v_event_name),true) where game_id=p_game_id;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'game.schedule_updated','game',p_game_id::text,jsonb_build_object('season_id',p_season_id,'event_id',p_event_id,'scheduled_start',p_scheduled_start,'game_number',p_game_number));
 if v_old_opponent is null and p_opponent_id is not null then
   insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
   values(p_user_id,v_org,'game.opponent_assigned','game',p_game_id::text,jsonb_build_object('opponent_id',p_opponent_id));
 end if;
end $$;

revoke all privileges on function public.create_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb,jsonb),
 public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.create_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb,jsonb),
 public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text) to service_role;

drop function public.list_team_hierarchy_games(uuid);
create function public.list_team_hierarchy_games(p_user_id uuid)
returns table(id uuid,season_id uuid,event_id uuid,opponent_id uuid,scheduled_start timestamptz,schedule_timezone text,game_number integer,game_label text,created_at timestamptz,game_status text,config jsonb)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select g.id,g.season_id,g.event_id,g.opponent_id,g.scheduled_start,g.schedule_timezone,g.game_number,g.game_label,g.created_at,coalesce(gs.state->>'status',g.status),g.config
from public.games g left join public.game_states gs on gs.game_id=g.id where g.organization_id=v_org and g.deleted_at is null
order by g.scheduled_start asc nulls last,g.created_at desc,g.id; end $$;
revoke all privileges on function public.list_team_hierarchy_games(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_team_hierarchy_games(uuid) to service_role;
notify pgrst,'reload schema';
