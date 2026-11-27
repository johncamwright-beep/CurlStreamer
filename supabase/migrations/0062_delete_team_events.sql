begin;
alter table public.events add column deleted_at timestamptz;

create or replace function public.soft_delete_team_event(p_user_id uuid,p_event_id uuid)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare
  v_org uuid:=public.verified_team_for_operation(p_user_id,false);
  v_game uuid;
  v_ids uuid[]:='{}';
begin
  if not exists(select 1 from public.team_memberships where user_id=p_user_id and organization_id=v_org and status='active' and role in ('owner','team_admin')) then
    raise exception 'team administrator required' using errcode='42501';
  end if;
  perform 1 from public.events where id=p_event_id and organization_id=v_org for update;
  if not found then raise exception 'event unavailable' using errcode='42501'; end if;
  for v_game in select id from public.games where event_id=p_event_id and organization_id=v_org order by id loop
    if exists(select 1 from public.games where id=v_game and deleted_at is null) then
      if not public.soft_delete_team_game(p_user_id,v_game) then
        raise exception 'game deletion unavailable' using errcode='55000';
      end if;
    end if;
    v_ids:=array_append(v_ids,v_game);
  end loop;
  update public.events set deleted_at=now(),archived_at=coalesce(archived_at,now()),updated_at=now()
    where id=p_event_id and deleted_at is null;
  if found then
    insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,'event.deleted','event',p_event_id::text,jsonb_build_object('game_ids',v_ids));
  end if;
  return v_ids;
end $$;
revoke all on function public.soft_delete_team_event(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.soft_delete_team_event(uuid,uuid) to service_role;

-- Serialize new assignments/restores with event deletion. Retained deleted games
-- remain attached to their event for audits, but cannot be restored into it.
create function public.guard_deleted_game_event()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_deleted timestamptz;
begin
  if new.event_id is null or new.deleted_at is not null then return new; end if;
  select deleted_at into v_deleted from public.events where id=new.event_id and organization_id=new.organization_id for share;
  if not found or v_deleted is not null then
    raise exception 'event unavailable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function public.guard_deleted_game_event() from public,anon,authenticated,service_role;
create trigger guard_deleted_game_event before insert or update of event_id,deleted_at on public.games
for each row execute function public.guard_deleted_game_event();

create or replace function public.list_events(p_user_id uuid,p_season_id uuid default null)
returns table(id uuid,season_id uuid,name text,event_type public.event_type,start_date date,end_date date,location text,timezone text,result text,level text,show_level boolean,accomplishment_year integer,archived_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return query select e.id,e.season_id,e.name,e.event_type,e.start_date,e.end_date,e.location,e.timezone,e.result,e.level,e.show_level,e.accomplishment_year,e.archived_at
from public.events e where e.organization_id=v_org and e.deleted_at is null and (p_season_id is null or e.season_id=p_season_id) order by e.start_date,e.id; end $$;
create or replace function public.list_team_hierarchy(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user_id,false);
begin return (select jsonb_build_object('seasons',coalesce(jsonb_agg(jsonb_build_object(
  'id',s.id,'name',s.name,'status',s.status,'startDate',s.start_date,'endDate',s.end_date,
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'name',e.name,'type',e.event_type,'timezone',e.timezone) order by e.start_date,e.id),'[]') from public.events e where e.season_id=s.id and e.organization_id=v_org and e.deleted_at is null)
) order by s.start_date desc,s.id),'[]')) from public.seasons s where s.organization_id=v_org); end $$;


notify pgrst,'reload schema';
commit;
