begin;
create function public.claim_shot_tracker_report_edition(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_upgrade boolean,p_edition integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.shot_tracker_reports; result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_edition is null or p_edition not in (9,12) or (p_edition=12 and p_audience<>'players')
    or p_lease is null or p_audience is null or p_audience not in ('coach','team','players')
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    then raise exception 'invalid request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  select * into r from public.shot_tracker_reports where organization_id=p_org
    and actor_user_id=p_actor and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint;
  if found and r.generation_version=p_edition and r.status='processing' and r.step_pending then
    update public.shot_tracker_reports set lease=p_lease,step_pending=false,updated_at=now() where id=r.id;
    return jsonb_build_object('status','claimed');
  end if;
  if not p_upgrade then
    select * into r from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor
      and event_id=p_event and audience=p_audience and status='ready' order by generation_version desc,updated_at desc,id limit 1;
    if found then return jsonb_build_object('status','ready','packet',r.packet); end if;
  end if;
  -- Explicit, once-per-edition upgrade. Keep old packets and the same event allowance.
  if p_upgrade and exists(select 1 from public.shot_tracker_reports where organization_id=p_org
    and actor_user_id=p_actor and event_id=p_event and audience=p_audience and status='ready') then
    select * into r from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor
      and event_id=p_event and audience=p_audience and status='ready' and generation_version=p_edition limit 1;
    if found then return jsonb_build_object('status','ready','packet',r.packet); end if;
    if not exists(select 1 from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event and actor_user_id=p_actor)
      then return jsonb_build_object('status','locked'); end if;
    if not exists(select 1 from public.games where organization_id=p_org and event_id=p_event and deleted_at is null)
      or exists(select 1 from public.games where organization_id=p_org and event_id=p_event and deleted_at is null and status::text<>'completed')
      then raise exception 'event incomplete' using errcode='23514'; end if;
    if exists(select 1 from public.shot_tracker_reports where organization_id=p_org and status='processing' and updated_at>now()-interval '3 minutes')
      then return jsonb_build_object('status','processing'); end if;
    if exists(select 1 from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
      and audience=p_audience and generation_version=p_edition and updated_at>now()-interval '3 minutes')
      then return jsonb_build_object('status','cooldown'); end if;
    if (select coalesce(sum(attempts),0) from public.shot_tracker_reports where organization_id=p_org and updated_at>now()-interval '24 hours')>=30
      then return jsonb_build_object('status','limit'); end if;
    insert into public.shot_tracker_reports(organization_id,actor_user_id,event_id,audience,fingerprint,status,lease,generation_version)
      values(p_org,p_actor,p_event,p_audience,p_fingerprint,'processing',p_lease,p_edition)
      on conflict(organization_id,actor_user_id,event_id,audience,fingerprint) do update
        set status='processing',generation_version=p_edition,lease=p_lease,step_pending=false,updated_at=now(),attempts=shot_tracker_reports.attempts+1;
    return jsonb_build_object('status','claimed');
  end if;
  result:=public.claim_shot_tracker_report(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease);
  if result->>'status'='claimed' then
    update public.shot_tracker_reports set generation_version=p_edition,step_pending=false where organization_id=p_org and actor_user_id=p_actor
      and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease;
  end if;
  return result;
end $$;
revoke all on function public.claim_shot_tracker_report_edition(uuid,uuid,uuid,text,text,uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.claim_shot_tracker_report_edition(uuid,uuid,uuid,text,text,uuid,boolean,integer) to service_role;

-- Older servers and already-running jobs retain their original edition.
create or replace function public.claim_shot_tracker_report_step(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_upgrade boolean default false)
returns jsonb language sql security definer set search_path='' as $$
  select public.claim_shot_tracker_report_edition(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease,p_upgrade,9)
$$;

create or replace function public.finish_shot_tracker_report_step(
  p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_packet jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare finished boolean;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  if not exists(select 1 from public.shot_tracker_report_events where organization_id=p_org and event_id=p_event and actor_user_id=p_actor)
    then return false; end if;
  if not exists(select 1 from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event
    and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and (generation_version=9 or (audience='players' and generation_version=12)))
    then return false; end if;
  finished:=public.finish_shot_tracker_report_v1(p_actor,p_org,p_event,p_audience,p_fingerprint,p_lease,p_packet);
  if finished and p_packet is not null then
    update public.shot_tracker_report_events set completed=array_append(completed,p_audience)
      where organization_id=p_org and event_id=p_event and not(p_audience=any(completed));
  end if;
  return finished;
end $$;
commit;
