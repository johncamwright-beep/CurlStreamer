begin;
alter table public.events add column accomplishment_year integer;
update public.events set accomplishment_year=extract(year from end_date)::integer;
alter table public.events alter column accomplishment_year set default extract(year from now() at time zone 'America/Toronto')::integer;
alter table public.events alter column accomplishment_year set not null;
alter table public.events add constraint event_accomplishment_year_range check(accomplishment_year between 1900 and 2100);
drop function public.create_event(uuid,uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean);
drop function public.update_event(uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean);
drop function public.list_events(uuid,uuid);
create function public.create_event(
  p_user_id uuid, p_event_id uuid, p_season_id uuid, p_name text,
  p_event_type public.event_type, p_start_date date, p_end_date date,
  p_location text, p_timezone text, p_result text default null,
  p_level text default null, p_show_level boolean default true, p_accomplishment_year integer default null
)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
  if p_result is not null and p_result not in ('1st', '2nd', '3rd', 'qualified') then
    raise exception 'valid event result required' using errcode='22023';
  end if;
  if p_level is not null and p_level not in ('U15', 'U18', 'U20', 'U25', 'Men’s', 'Women’s') then
    raise exception 'valid event level required' using errcode='22023';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'valid IANA timezone required' using errcode='22023'; end if;
  if not exists(select 1 from public.seasons where id=p_season_id and organization_id=v_org and status<>'archived') then raise exception 'available season required' using errcode='23514'; end if;
  insert into public.events(id,organization_id,season_id,name,event_type,start_date,end_date,location,timezone,result,level,show_level,accomplishment_year,created_by)
  values(p_event_id,v_org,p_season_id,btrim(p_name),p_event_type,p_start_date,p_end_date,nullif(btrim(p_location),''),p_timezone,p_result,p_level,p_show_level,coalesce(p_accomplishment_year,extract(year from now() at time zone 'America/Toronto')::integer),p_user_id);
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'event.created','event',p_event_id::text,jsonb_build_object('season_id',p_season_id,'event_type',p_event_type,'result',p_result,'level',p_level,'show_level',p_show_level));
  return p_event_id;
end $$;

create function public.update_event(
  p_user_id uuid, p_event_id uuid, p_name text, p_event_type public.event_type,
  p_start_date date, p_end_date date, p_location text, p_timezone text,
  p_result text default '__unchanged__', p_level text default '__unchanged__',
  p_show_level boolean default null, p_accomplishment_year integer default null
)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,true);
begin
  if p_result <> '__unchanged__' and p_result is not null and p_result not in ('1st', '2nd', '3rd', 'qualified') then
    raise exception 'valid event result required' using errcode='22023';
  end if;
  if p_level <> '__unchanged__' and p_level is not null and p_level not in ('U15', 'U18', 'U20', 'U25', 'Men’s', 'Women’s') then
    raise exception 'valid event level required' using errcode='22023';
  end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'valid IANA timezone required' using errcode='22023'; end if;
  update public.events set name=btrim(p_name),event_type=p_event_type,start_date=p_start_date,end_date=p_end_date,
    location=nullif(btrim(p_location),''),timezone=p_timezone,
    result=case when p_result='__unchanged__' then result else p_result end,
    level=case when p_level='__unchanged__' then level else p_level end,
    show_level=coalesce(p_show_level,show_level),accomplishment_year=coalesce(p_accomplishment_year,accomplishment_year),updated_at=now()
  where id=p_event_id and organization_id=v_org and archived_at is null;
  if not found then raise exception 'active event required' using errcode='23514'; end if;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'event.updated','event',p_event_id::text,jsonb_build_object('event_type',p_event_type));
end $$;

create function public.list_events(p_user_id uuid,p_season_id uuid default null)
returns table(id uuid,season_id uuid,name text,event_type public.event_type,start_date date,end_date date,location text,timezone text,result text,level text,show_level boolean,accomplishment_year integer,archived_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select e.id,e.season_id,e.name,e.event_type,e.start_date,e.end_date,e.location,e.timezone,e.result,e.level,e.show_level,e.accomplishment_year,e.archived_at
from public.events e where e.organization_id=v_org and (p_season_id is null or e.season_id=p_season_id) order by e.start_date,e.id; end $$;

revoke all privileges on function public.create_event(uuid,uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean,integer), public.update_event(uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean,integer), public.list_events(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.create_event(uuid,uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean,integer), public.update_event(uuid,uuid,text,public.event_type,date,date,text,text,text,text,boolean,integer), public.list_events(uuid,uuid) to service_role;


notify pgrst, 'reload schema';
commit;
