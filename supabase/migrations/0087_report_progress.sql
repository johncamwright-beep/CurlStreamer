begin;
-- Durable per-player checkpoints, private to the existing report author/lease.
alter table public.shot_tracker_reports add column progress jsonb not null default '{}'::jsonb;
alter table public.shot_tracker_reports add column step_pending boolean not null default false;
alter table public.shot_tracker_reports add column generation_version integer not null default 8;

create function public.claim_shot_tracker_report_step(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_upgrade boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.shot_tracker_reports; result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_lease is null or p_audience is null or p_audience not in ('coach','team','players')
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    then raise exception 'invalid request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  select * into r from public.shot_tracker_reports where organization_id=p_org
    and actor_user_id=p_actor and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint;
  if found and r.status='processing' and r.step_pending then
    update public.shot_tracker_reports set lease=p_lease,step_pending=false,updated_at=now() where id=r.id;
    return jsonb_build_object('status','claimed');
  end if;
  -- Explicit, once-per-edition upgrade. Keep old packets and the same event allowance.
  if p_upgrade and exists(select 1 from public.shot_tracker_reports where organization_id=p_org
    and actor_user_id=p_actor and event_id=p_event and audience=p_audience and status='ready') then
    select * into r from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor
      and event_id=p_event and audience=p_audience and status='ready' and generation_version=9 limit 1;
    if found then return jsonb_build_object('status','ready','packet',r.packet); end if;
    if not exists(select 1 from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event and actor_user_id=p_actor)
      then return jsonb_build_object('status','locked'); end if;
    if not exists(select 1 from public.games where organization_id=p_org and event_id=p_event and deleted_at is null)
      or exists(select 1 from public.games where organization_id=p_org and event_id=p_event and deleted_at is null and status::text<>'completed')
      then raise exception 'event incomplete' using errcode='23514'; end if;
    if exists(select 1 from public.shot_tracker_reports where organization_id=p_org and status='processing' and updated_at>now()-interval '3 minutes')
      then return jsonb_build_object('status','processing'); end if;
    if exists(select 1 from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
      and audience=p_audience and generation_version=9 and updated_at>now()-interval '3 minutes')
      then return jsonb_build_object('status','cooldown'); end if;
    if (select coalesce(sum(attempts),0) from public.shot_tracker_reports where organization_id=p_org and updated_at>now()-interval '24 hours')>=30
      then return jsonb_build_object('status','limit'); end if;
    insert into public.shot_tracker_reports(organization_id,actor_user_id,event_id,audience,fingerprint,status,lease,generation_version)
      values(p_org,p_actor,p_event,p_audience,p_fingerprint,'processing',p_lease,9)
      on conflict(organization_id,actor_user_id,event_id,audience,fingerprint) do update
        set status='processing',lease=p_lease,step_pending=false,updated_at=now(),attempts=shot_tracker_reports.attempts+1;
    return jsonb_build_object('status','claimed');
  end if;
  result:=public.claim_shot_tracker_report(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease);
  if result->>'status'='claimed' then
    update public.shot_tracker_reports set generation_version=9,step_pending=false where organization_id=p_org and actor_user_id=p_actor
      and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease;
  end if;
  return result;
end $$;

create function public.release_shot_tracker_report_step(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid
) returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  update public.shot_tracker_reports set step_pending=true,updated_at=now()
    where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
      and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and status='processing';
  get diagnostics affected=row_count;
  return affected=1;
end $$;
revoke all on function public.claim_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid,boolean),public.release_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid,boolean),public.release_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid) to service_role;

create function public.finish_shot_tracker_report_step(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_packet jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare finished boolean;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  if not exists(select 1 from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event and actor_user_id=p_actor)
    then return false; end if;
  if not exists(select 1 from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
    and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and generation_version=9)
    then return false; end if;
  finished:=public.finish_shot_tracker_report_v1(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease,p_packet);
  if finished and p_packet is not null then
    update public.shot_tracker_report_events set completed=array_append(completed,p_audience)
      where organization_id=p_org and event_id=p_event and not(p_audience=any(completed));
  end if;
  return finished;
end $$;
revoke all on function public.finish_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.finish_shot_tracker_report_step(uuid,uuid,uuid,text,text,uuid,jsonb) to service_role;

create or replace function public.read_shot_tracker_reports(p_actor uuid,p_org uuid,p_event uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'actor_user_id'-'organization_id'),'[]'::jsonb) into result from (
    select distinct on (audience) * from public.shot_tracker_reports
    where actor_user_id=p_actor and organization_id=p_org and event_id=p_event
    order by audience,generation_version desc,(status='ready') desc,updated_at desc,id
  ) r;
  return result;
end $$;

create function public.checkpoint_shot_tracker_report(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,
  p_key text,p_report jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_key is null or p_key !~ '^(coach|team|player-[1-8])$'
    or jsonb_typeof(p_report) is distinct from 'object'
    or p_report->>'key' is distinct from p_key
    or octet_length(p_report::text)>250000 then
    raise exception 'invalid report checkpoint' using errcode='22023';
  end if;
  update public.shot_tracker_reports
  set progress=jsonb_set(progress,array[p_key],p_report),updated_at=now()
  where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
    and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and status='processing';
  get diagnostics affected=row_count;
  return affected=1;
end $$;
revoke all on function public.checkpoint_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.checkpoint_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,text,jsonb) to service_role;

-- Bounded aggregate packet supports eight independently validated player reports.
create or replace function public.finish_shot_tracker_report_v1(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_packet jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_packet is not null and (jsonb_typeof(p_packet)<>'object' or octet_length(p_packet::text)>2100000 or p_packet->>'audience' is distinct from p_audience) then
    raise exception 'invalid report packet' using errcode='22023';
  end if;
  update public.shot_tracker_reports set status=case when p_packet is null then 'failed' else 'ready' end,
    packet=p_packet,updated_at=now()
    where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and status='processing';
  get diagnostics affected=row_count;
  return affected=1;
end $$;

commit;
