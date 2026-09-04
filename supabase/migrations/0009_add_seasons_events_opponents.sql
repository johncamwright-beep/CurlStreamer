-- Team-scoped scheduling foundation. Existing games are deliberately left
-- unassigned; all hierarchy columns added below are nullable.
create type public.season_status as enum ('draft', 'active', 'archived');
create type public.event_type as enum ('tournament', 'bonspiel', 'league', 'exhibition', 'other');

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  start_date date not null,
  end_date date not null,
  status public.season_status not null default 'draft',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (id, organization_id)
);
create unique index seasons_one_active_per_organization
  on public.seasons (organization_id) where status = 'active';
create index seasons_organization_dates_idx
  on public.seasons (organization_id, start_date desc, id);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  season_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 150),
  event_type public.event_type not null,
  start_date date not null,
  end_date date not null,
  location text check (location is null or length(btrim(location)) between 1 and 200),
  timezone text not null check (length(btrim(timezone)) between 1 and 100),
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date),
  unique (id, organization_id),
  unique (id, organization_id, season_id),
  foreign key (season_id, organization_id)
    references public.seasons (id, organization_id) on delete restrict
);
create index events_organization_season_dates_idx
  on public.events (organization_id, season_id, start_date, id);

create table public.opponents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  normalized_name text generated always as
    (lower(regexp_replace(btrim(display_name), '\s+', ' ', 'g'))) stored,
  archived_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (organization_id, normalized_name)
);
create index opponents_organization_active_name_idx
  on public.opponents (organization_id, normalized_name) where archived_at is null;

alter table public.games
  add column season_id uuid,
  add column event_id uuid,
  add column opponent_id uuid,
  add column scheduled_start timestamptz,
  add column game_number integer check (game_number is null or game_number > 0),
  add column game_label text check (game_label is null or length(btrim(game_label)) between 1 and 100),
  add foreign key (season_id, organization_id)
    references public.seasons (id, organization_id) on delete restrict,
  add foreign key (event_id, organization_id, season_id)
    references public.events (id, organization_id, season_id) on delete restrict,
  add foreign key (opponent_id, organization_id)
    references public.opponents (id, organization_id) on delete restrict,
  add check (event_id is null or season_id is not null);
create unique index games_event_game_number_unique
  on public.games (event_id, game_number)
  where event_id is not null and game_number is not null;
create index games_event_schedule_idx
  on public.games (event_id, scheduled_start, game_number, id) where event_id is not null;
create index games_opponent_history_idx
  on public.games (opponent_id, scheduled_start desc) where opponent_id is not null;

alter table public.seasons enable row level security;
alter table public.events enable row level security;
alter table public.opponents enable row level security;
revoke all privileges on table public.seasons, public.events, public.opponents
from public, anon, authenticated, service_role;
grant select, insert, update on table public.seasons, public.events, public.opponents
to service_role;

-- Every operation resolves the organization from exactly one verified active
-- membership. It never accepts a browser-selected organization identifier.
create function public.verified_team_for_operation(p_user_id uuid, p_require_write boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_count integer;
begin
  if not exists (select 1 from public.user_profiles where user_id = p_user_id and status = 'active') then
    raise exception 'active account required' using errcode = '42501';
  end if;
  select count(*), min(organization_id::text)::uuid into v_count, v_org
  from public.team_memberships where user_id = p_user_id and status = 'active';
  if v_count = 0 then raise exception 'team setup required' using errcode = 'P0001'; end if;
  if v_count > 1 then raise exception 'team selection required' using errcode = 'P0002'; end if;
  if p_require_write and not exists (
    select 1 from public.team_memberships where user_id = p_user_id
      and organization_id = v_org and status = 'active'
      and role in ('owner', 'team_admin', 'scorer')
  ) then raise exception 'permitted active team membership required' using errcode = '42501'; end if;
  return v_org;
end $$;

create function public.create_season(p_user_id uuid, p_season_id uuid, p_name text, p_start_date date, p_end_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, true);
begin
  insert into public.seasons(id, organization_id, name, start_date, end_date, created_by)
  values (p_season_id, v_org, btrim(p_name), p_start_date, p_end_date, p_user_id);
  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values(p_user_id, v_org, 'season.created', 'season', p_season_id::text, jsonb_build_object('name', left(btrim(p_name),100)));
  return p_season_id;
end $$;

create function public.list_seasons(p_user_id uuid)
returns table(id uuid, name text, start_date date, end_date date, status public.season_status, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin return query select s.id,s.name,s.start_date,s.end_date,s.status,s.created_at,s.updated_at
from public.seasons s where s.organization_id=v_org order by s.start_date desc,s.id; end $$;

create function public.set_current_season(p_user_id uuid, p_season_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id,true);
begin
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 9));
  if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status <> 'archived') then
    raise exception 'available season required' using errcode='23514'; end if;
  update public.seasons set status='draft',updated_at=now() where organization_id=v_org and status='active' and id<>p_season_id;
  update public.seasons set status='active',updated_at=now() where organization_id=v_org and id=p_season_id;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'season.activated','season',p_season_id::text,'{}');
end $$;

create function public.archive_season(p_user_id uuid,p_season_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
  if exists(select 1 from public.events where season_id=p_season_id and organization_id=v_org and archived_at is null) then
    raise exception 'archive active events first' using errcode='23514'; end if;
  update public.seasons set status='archived',updated_at=now() where id=p_season_id and organization_id=v_org and status<>'archived';
  if not found then raise exception 'available season required' using errcode='23514'; end if;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'season.archived','season',p_season_id::text,'{}');
end $$;

create function public.create_event(p_user_id uuid,p_event_id uuid,p_season_id uuid,p_name text,p_event_type public.event_type,p_start_date date,p_end_date date,p_location text,p_timezone text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'valid IANA timezone required' using errcode='22023'; end if;
  if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then raise exception 'available season required' using errcode='23514'; end if;
  insert into public.events(id,organization_id,season_id,name,event_type,start_date,end_date,location,timezone,created_by)
  values(p_event_id,v_org,p_season_id,btrim(p_name),p_event_type,p_start_date,p_end_date,nullif(btrim(p_location),''),p_timezone,p_user_id);
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'event.created','event',p_event_id::text,jsonb_build_object('season_id',p_season_id,'event_type',p_event_type));
  return p_event_id;
end $$;

create function public.update_event(p_user_id uuid,p_event_id uuid,p_name text,p_event_type public.event_type,p_start_date date,p_end_date date,p_location text,p_timezone text)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'valid IANA timezone required' using errcode='22023'; end if;
  update public.events set name=btrim(p_name),event_type=p_event_type,start_date=p_start_date,end_date=p_end_date,
    location=nullif(btrim(p_location),''),timezone=p_timezone,updated_at=now()
  where id=p_event_id and organization_id=v_org and archived_at is null;
  if not found then raise exception 'active event required' using errcode='23514'; end if;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'event.updated','event',p_event_id::text,jsonb_build_object('event_type',p_event_type));
end $$;

create function public.archive_event(p_user_id uuid,p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
 update public.events set archived_at=now(),updated_at=now() where id=p_event_id and organization_id=v_org and archived_at is null;
 if not found then raise exception 'active event required' using errcode='23514'; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'event.archived','event',p_event_id::text,'{}');
end $$;

create function public.list_events(p_user_id uuid,p_season_id uuid default null)
returns table(id uuid,season_id uuid,name text,event_type public.event_type,start_date date,end_date date,location text,timezone text,archived_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select e.id,e.season_id,e.name,e.event_type,e.start_date,e.end_date,e.location,e.timezone,e.archived_at
from public.events e where e.organization_id=v_org and (p_season_id is null or e.season_id=p_season_id) order by e.start_date,e.id; end $$;

create function public.find_or_create_opponent(p_user_id uuid,p_opponent_id uuid,p_display_name text)
returns table(opponent_id uuid,display_name text,restored boolean)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_id uuid; v_name text; v_archived timestamptz;
begin
  select o.id,o.display_name,o.archived_at into v_id,v_name,v_archived from public.opponents o
  where o.organization_id=v_org and o.normalized_name=lower(regexp_replace(btrim(p_display_name),'\s+',' ','g')) for update;
  if found then
    if v_archived is not null then
      update public.opponents set archived_at=null,display_name=btrim(p_display_name),updated_at=now() where id=v_id;
      insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
      values(p_user_id,v_org,'opponent.restored','opponent',v_id::text,'{}');
    end if;
    return query select v_id,coalesce(nullif(btrim(p_display_name),''),v_name),v_archived is not null; return;
  end if;
  begin
    insert into public.opponents(id,organization_id,display_name,created_by) values(p_opponent_id,v_org,btrim(p_display_name),p_user_id) returning id,opponents.display_name into v_id,v_name;
  exception when unique_violation then
    select o.id,o.display_name into v_id,v_name from public.opponents o where o.organization_id=v_org and o.normalized_name=lower(regexp_replace(btrim(p_display_name),'\s+',' ','g'));
  end;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'opponent.created','opponent',v_id::text,jsonb_build_object('display_name',left(v_name,100)));
  return query select v_id,v_name,false;
end $$;

create function public.list_opponents(p_user_id uuid,p_include_archived boolean default false)
returns table(id uuid,display_name text,archived_at timestamptz,games_played bigint,last_played_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select o.id,o.display_name,o.archived_at,count(g.id),max(g.scheduled_start)
from public.opponents o left join public.games g on g.opponent_id=o.id and g.organization_id=v_org
where o.organization_id=v_org and (p_include_archived or o.archived_at is null)
group by o.id order by o.normalized_name,o.id; end $$;

create function public.set_opponent_archived(p_user_id uuid,p_opponent_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_action text;
begin
 update public.opponents set archived_at=case when p_archived then now() else null end,updated_at=now()
 where id=p_opponent_id and organization_id=v_org and ((p_archived and archived_at is null) or (not p_archived and archived_at is not null));
 if not found then raise exception 'opponent state conflict' using errcode='23514'; end if;
 v_action:=case when p_archived then 'opponent.archived' else 'opponent.restored' end;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,v_action,'opponent',p_opponent_id::text,'{}');
end $$;

create function public.list_team_hierarchy(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return (select jsonb_build_object('seasons',coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'status',s.status,'startDate',s.start_date,'endDate',s.end_date,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'type',e.event_type,'timezone',e.timezone) order by e.start_date,e.id),'[]') from public.events e where e.season_id=s.id and e.organization_id=v_org)
) order by s.start_date desc,s.id),'[]')) from public.seasons s where s.organization_id=v_org); end $$;

create function public.create_scheduled_team_game(
 p_user_id uuid,p_game_id uuid,p_event_id uuid,p_opponent_id uuid,p_scheduled_start timestamptz,
 p_game_number integer,p_game_label text,p_config jsonb,p_state jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true); v_season uuid; v_existing uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_game_id::text,9));
 if p_game_number is null or p_game_number<=0 or p_scheduled_start is null then raise exception 'valid schedule required' using errcode='22023'; end if;
 select season_id into v_season from public.events where id=p_event_id and organization_id=v_org and archived_at is null;
 if v_season is null then raise exception 'active event required' using errcode='23514'; end if;
 if not exists(select 1 from public.seasons where id=v_season and organization_id=v_org and status<>'archived') then raise exception 'active season required' using errcode='23514'; end if;
 if not exists(select 1 from public.opponents where id=p_opponent_id and organization_id=v_org and archived_at is null) then raise exception 'active opponent required' using errcode='23514'; end if;
 select organization_id into v_existing from public.games where id=p_game_id;
 if found then
   if v_existing<>v_org then raise exception 'game identifier belongs to another organization' using errcode='23505'; end if;
   if not exists(select 1 from public.game_states where game_id=p_game_id) then raise exception 'existing game has no initial state' using errcode='23514'; end if;
   return;
 end if;
 insert into public.organizer_users(organization_id,user_id) values(v_org,p_user_id) on conflict do nothing;
 insert into public.games(id,organization_id,config,status,created_by,season_id,event_id,opponent_id,scheduled_start,game_number,game_label)
 values(p_game_id,v_org,p_config,'active',p_user_id,v_season,p_event_id,p_opponent_id,p_scheduled_start,p_game_number,nullif(btrim(p_game_label),''));
 insert into public.game_states(game_id,state) values(p_game_id,p_state);
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user_id,v_org,'game.created','game',p_game_id::text,jsonb_build_object('source','scheduled_event_creation','event_id',p_event_id,'opponent_id',p_opponent_id,'game_number',p_game_number));
end $$;

revoke all privileges on function public.verified_team_for_operation(uuid,boolean) from public,anon,authenticated,service_role;
revoke all privileges on function public.create_season(uuid,uuid,text,date,date), public.list_seasons(uuid), public.set_current_season(uuid,uuid), public.archive_season(uuid,uuid), public.create_event(uuid,uuid,uuid,text,public.event_type,date,date,text,text), public.update_event(uuid,uuid,text,public.event_type,date,date,text,text), public.archive_event(uuid,uuid), public.list_events(uuid,uuid), public.find_or_create_opponent(uuid,uuid,text), public.list_opponents(uuid,boolean), public.set_opponent_archived(uuid,uuid,boolean), public.list_team_hierarchy(uuid), public.create_scheduled_team_game(uuid,uuid,uuid,uuid,timestamptz,integer,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_season(uuid,uuid,text,date,date), public.list_seasons(uuid), public.set_current_season(uuid,uuid), public.archive_season(uuid,uuid), public.create_event(uuid,uuid,uuid,text,public.event_type,date,date,text,text), public.update_event(uuid,uuid,text,public.event_type,date,date,text,text), public.archive_event(uuid,uuid), public.list_events(uuid,uuid), public.find_or_create_opponent(uuid,uuid,text), public.list_opponents(uuid,boolean), public.set_opponent_archived(uuid,uuid,boolean), public.list_team_hierarchy(uuid), public.create_scheduled_team_game(uuid,uuid,uuid,uuid,timestamptz,integer,text,jsonb,jsonb) to service_role;

notify pgrst, 'reload schema';
