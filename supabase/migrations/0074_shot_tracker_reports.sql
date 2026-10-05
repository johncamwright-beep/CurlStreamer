-- Private optional-module reports. Existing team accounts/entitlements are reused.
create table public.shot_tracker_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  audience text not null check (audience in ('coach','team','players')),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null check (status in ('processing','ready','failed')),
  lease uuid not null,
  attempts integer not null default 1,
  packet jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_id,actor_user_id,event_id,audience,fingerprint)
);
alter table public.shot_tracker_reports enable row level security;
revoke all on public.shot_tracker_reports from public,anon,authenticated,service_role;

create function public.shot_tracker_report_access(p_actor uuid,p_org uuid,p_event uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_curlcoach_access(p_actor,p_org);
  if not exists(select 1 from public.events where id=p_event and organization_id=p_org) then
    raise exception 'event unavailable' using errcode='42501';
  end if;
end $$;

create function public.read_shot_tracker_reports(p_actor uuid,p_org uuid,p_event uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'actor_user_id'-'organization_id'),'[]'::jsonb) into result from (
    select distinct on (audience) * from public.shot_tracker_reports
    where actor_user_id=p_actor and organization_id=p_org and event_id=p_event
    order by audience,updated_at desc,id desc
  ) r;
  return result;
end $$;

create function public.claim_shot_tracker_report(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.shot_tracker_reports; recent_count integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_audience not in ('coach','team','players') or p_audience is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_lease is null then
    raise exception 'invalid report request' using errcode='22023';
  end if;
  -- All generations for an organization serialize their claim and daily allowance.
  perform pg_advisory_xact_lock(hashtextextended('shot-tracker-report:'||p_org::text,0));
  if not exists(select 1 from public.games where event_id=p_event and organization_id=p_org and deleted_at is null)
    or exists(select 1 from public.games where event_id=p_event and organization_id=p_org and deleted_at is null and status::text <> 'completed') then
    raise exception 'event incomplete' using errcode='23514';
  end if;
  select * into r from public.shot_tracker_reports where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint;
  if found and r.status='ready' then
    update public.shot_tracker_reports set updated_at=now() where id=r.id;
    return jsonb_build_object('status','ready','packet',r.packet);
  end if;
  if found and r.updated_at>now()-interval '3 minutes' then
    return jsonb_build_object('status',case when r.status='processing' then 'processing' else 'cooldown' end);
  end if;
  if exists(select 1 from public.shot_tracker_reports where organization_id=p_org and status='processing' and updated_at>now()-interval '3 minutes') then
    return jsonb_build_object('status','processing');
  end if;
  select coalesce(sum(attempts),0) into recent_count from public.shot_tracker_reports where organization_id=p_org and updated_at>now()-interval '24 hours';
  if recent_count>=30 then return jsonb_build_object('status','limit'); end if;
  insert into public.shot_tracker_reports(organization_id,actor_user_id,event_id,audience,fingerprint,status,lease)
  values(p_org,p_actor,p_event,p_audience,p_fingerprint,'processing',p_lease)
  on conflict(organization_id,actor_user_id,event_id,audience,fingerprint) do update
    set status='processing',lease=p_lease,packet=null,updated_at=now(),attempts=shot_tracker_reports.attempts+1;
  return jsonb_build_object('status','claimed');
end $$;

create function public.finish_shot_tracker_report(p_actor uuid,p_org uuid,p_event uuid,p_audience text,p_fingerprint text,p_lease uuid,p_packet jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  perform public.shot_tracker_report_access(p_actor,p_org,p_event);
  if p_packet is not null and (jsonb_typeof(p_packet)<>'object' or octet_length(p_packet::text)>300000 or p_packet->>'audience' is distinct from p_audience) then
    raise exception 'invalid report packet' using errcode='22023';
  end if;
  update public.shot_tracker_reports set status=case when p_packet is null then 'failed' else 'ready' end,
    packet=p_packet,updated_at=now()
    where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and audience=p_audience and fingerprint=p_fingerprint and lease=p_lease and status='processing';
  get diagnostics affected=row_count;
  return affected=1;
end $$;
revoke all on function public.shot_tracker_report_access(uuid,uuid,uuid),public.read_shot_tracker_reports(uuid,uuid,uuid),public.claim_shot_tracker_report(uuid,uuid,uuid,text,text,uuid),public.finish_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_shot_tracker_reports(uuid,uuid,uuid),public.claim_shot_tracker_report(uuid,uuid,uuid,text,text,uuid),public.finish_shot_tracker_report(uuid,uuid,uuid,text,text,uuid,jsonb) to service_role;
