-- Team-wide event reservations survive event/user deletion and data edits.
begin;
-- Billing seasons run September 1 through August 31 in America/Toronto.
create table public.shot_tracker_report_events (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null,
  actor_user_id uuid not null,
  season_start date not null,
  completed text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (organization_id,event_id)
);
alter table public.shot_tracker_report_events enable row level security;
revoke all on public.shot_tracker_report_events from public,anon,authenticated,service_role;

create function public.shot_tracker_report_season(p_at timestamptz)
returns date language sql immutable set search_path='' as $$
  select make_date(extract(year from (p_at at time zone 'America/Toronto') - interval '8 months')::integer,9,1)
$$;
revoke all on function public.shot_tracker_report_season(timestamptz) from public,anon,authenticated,service_role;

-- Preserve existing successes and reserve each previously attempted event once.
insert into public.shot_tracker_report_events(organization_id,event_id,actor_user_id,season_start,created_at)
select distinct on (organization_id,event_id) organization_id,event_id,actor_user_id,
  public.shot_tracker_report_season(created_at),created_at
from public.shot_tracker_reports
order by organization_id,event_id,(status='ready') desc,created_at,id;
update public.shot_tracker_report_events e set completed=(
  select array_agg(distinct r.audience) from public.shot_tracker_reports r
  where r.organization_id=e.organization_id and r.event_id=e.event_id and r.status='ready'
) where exists(select 1 from public.shot_tracker_reports r where r.organization_id=e.organization_id and r.event_id=e.event_id and r.status='ready');

alter function public.claim_shot_tracker_report(uuid,uuid,uuid,text,text,uuid) rename to claim_shot_tracker_report_v1;
alter function public.finish_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,jsonb) rename to finish_shot_tracker_report_v1;
revoke all on function public.claim_shot_tracker_report_v1(uuid,uuid,uuid,text,text,uuid),public.finish_shot_tracker_report_v1(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;

create function public.read_shot_tracker_report_allowance(p_actor uuid,p_org uuid,p_event uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.shot_tracker_report_events; s date:=public.shot_tracker_report_season(now()); n integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  select * into e from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event;
  select count(*) into n from public.shot_tracker_report_events where organization_id=p_org and season_start=s;
  return jsonb_build_object('seasonStart',s,'used',n,'limit',20,'reserved',e.event_id is not null,
    'owned',e.event_id is null or e.actor_user_id=p_actor,'completed',coalesce(e.completed,'{}'::text[]));
end $$;
-- All schema and RPC changes are installed atomically.

create function public.claim_shot_tracker_report(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.shot_tracker_report_events; r public.shot_tracker_reports;
  s date:=public.shot_tracker_report_season(now()); n integer; result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_audience is null or p_audience not in ('coach','team','players') or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_lease is null then
    raise exception 'invalid report request' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  -- Success is permanent across fingerprints, model upgrades and later seasons.
  select * into r from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and audience=p_audience and status='ready' order by created_at,id limit 1;
  if found then return jsonb_build_object('status','ready','packet',r.packet); end if;
  select * into e from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event;
  if found then
    if e.actor_user_id<>p_actor or p_audience=any(e.completed) then return jsonb_build_object('status','locked'); end if;
  else
    select count(*) into n from public.shot_tracker_report_events where organization_id=p_org and season_start=s;
    if n>=20 then return jsonb_build_object('status','season_limit'); end if;
  end if;
  -- Changing source data cannot bypass failed-attempt cooldowns.
  select * into r from public.shot_tracker_reports where organization_id=p_org and event_id=p_event and audience=p_audience order by updated_at desc,id desc limit 1;
  if found and r.updated_at>now()-interval '3 minutes' then
    return jsonb_build_object('status',case when r.status='processing' then 'processing' else 'cooldown' end);
  end if;
  result:=public.claim_shot_tracker_report_v1(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease);
  if result->>'status'='claimed' then
    insert into public.shot_tracker_report_events(organization_id,event_id,actor_user_id,season_start)
      values(p_org,p_event,p_actor,s) on conflict do nothing;
  end if;
  return result;
end $$;

create function public.finish_shot_tracker_report(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_packet jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare e public.shot_tracker_report_events; finished boolean;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  select * into e from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event;
  if not found or e.actor_user_id<>p_actor or p_audience=any(e.completed) then return false; end if;
  finished:=public.finish_shot_tracker_report_v1(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease,p_packet);
  if finished and p_packet is not null then
    update public.shot_tracker_report_events set completed=array_append(completed,p_audience) where organization_id=p_org and event_id=p_event;
  end if;
  return finished;
end $$;
revoke all on function public.read_shot_tracker_report_allowance(uuid,uuid,uuid),public.claim_shot_tracker_report(uuid,uuid,uuid,text,text,uuid),public.finish_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_shot_tracker_report_allowance(uuid,uuid,uuid),public.claim_shot_tracker_report(uuid,uuid,uuid,text,text,uuid),public.finish_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,jsonb) to service_role;

create or replace function public.read_shot_tracker_reports(p_actor uuid,p_org uuid,p_event uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'actor_user_id'-'organization_id'),'[]'::jsonb) into result from (
    select distinct on (audience) * from public.shot_tracker_reports
    where actor_user_id=p_actor and organization_id=p_org and event_id=p_event
    order by audience,(status='ready') desc,case when status='ready' then created_at end,updated_at desc,id
  ) r;
  return result;
end $$;
commit;
