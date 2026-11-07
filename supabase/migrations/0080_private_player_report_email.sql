begin;
create table public.team_player_contacts (
  organization_id uuid not null references public.organizations(id),
  player_id text not null check(player_id ~ '^[a-f0-9]{64}$'),
  player_name text not null check(length(player_name) between 1 and 200),
  email text check(email is null or (length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  updated_at timestamptz not null default now(), primary key(organization_id,player_id)
);
alter table public.team_player_contacts enable row level security;
revoke all on public.team_player_contacts from public,anon,authenticated;
grant select,insert,update on public.team_player_contacts to service_role;
create table public.shot_tracker_report_emails (
  id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
  actor_user_id uuid not null references auth.users(id), event_id uuid not null references public.events(id),
  delivery_key text not null check(delivery_key ~ '^[a-f0-9]{64}$'),
  status text not null check(status in ('sending','accepted','failed','unknown')), lease uuid not null,
  attempts integer not null default 1, updated_at timestamptz not null default now(),
  unique(organization_id,actor_user_id,event_id,delivery_key)
);
alter table public.shot_tracker_report_emails enable row level security;
revoke all on public.shot_tracker_report_emails from public,anon,authenticated,service_role;
create function public.claim_report_email(p_actor uuid,p_org uuid,p_event uuid,p_key text,p_lease uuid,p_resend boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare r public.shot_tracker_report_emails; n integer;
begin
 perform public.shot_tracker_report_access(p_actor,p_org,p_event);
 if p_key is null or p_key !~ '^[a-f0-9]{64}$' or p_lease is null then raise exception 'invalid delivery' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('report-email:'||p_org::text,0));
 select * into r from public.shot_tracker_report_emails where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and delivery_key=p_key;
 if found then
   if r.updated_at>now()-interval '1 minute' then return 'recent'; end if;
   if r.status='sending' and r.updated_at>now()-interval '5 minutes' then return 'sending'; end if;
   if not p_resend then return r.status; end if;
 end if;
 select coalesce(sum(attempts),0) into n from public.shot_tracker_report_emails where organization_id=p_org and updated_at>now()-interval '1 hour';
 if n>=30 then return 'limit'; end if;
 insert into public.shot_tracker_report_emails(organization_id,actor_user_id,event_id,delivery_key,status,lease)
 values(p_org,p_actor,p_event,p_key,'sending',p_lease)
 on conflict(organization_id,actor_user_id,event_id,delivery_key) do update set status='sending',lease=p_lease,attempts=shot_tracker_report_emails.attempts+1,updated_at=now();
 return 'claimed';
end $$;
create function public.finish_report_email(p_actor uuid,p_org uuid,p_event uuid,p_key text,p_lease uuid,p_status text)
returns boolean language plpgsql security definer set search_path='' as $$
declare n integer;
begin
 perform public.shot_tracker_report_access(p_actor,p_org,p_event);
 if p_status not in ('accepted','failed','unknown') or p_status is null then raise exception 'invalid status'; end if;
 update public.shot_tracker_report_emails set status=p_status,updated_at=now()
 where organization_id=p_org and actor_user_id=p_actor and event_id=p_event and delivery_key=p_key and lease=p_lease and status='sending';
 get diagnostics n=row_count; return n=1;
end $$;
revoke all on function public.claim_report_email(uuid,uuid,uuid,text,uuid,boolean),public.finish_report_email(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_report_email(uuid,uuid,uuid,text,uuid,boolean),public.finish_report_email(uuid,uuid,uuid,text,uuid,text) to service_role;
commit;
