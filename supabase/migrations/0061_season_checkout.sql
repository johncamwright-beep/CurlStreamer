begin;
create table public.team_season_customers(organization_id uuid references public.organizations(id) primary key, test_customer_id text unique, live_customer_id text unique);
create table public.team_season_orders(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id), livemode boolean not null,
 season_end timestamptz not null, base boolean not null, coach_quantity integer not null check(coach_quantity between 0 and 2),
 session_id text unique, payment_intent_id text unique, status text not null default 'pending' check(status in ('pending','paid','revoked','expired')),
 sync_token uuid,sync_until timestamptz, created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(base or coach_quantity>0)
);
create unique index season_one_pending_checkout on public.team_season_orders(organization_id,livemode) where status='pending';
create table public.stripe_season_events(event_id text primary key,processed_at timestamptz not null default now());
alter table public.team_season_customers enable row level security;
alter table public.team_season_orders enable row level security;
alter table public.stripe_season_events enable row level security;
revoke all on public.team_season_customers,public.team_season_orders,public.stripe_season_events from public,anon,authenticated;
grant all on public.team_season_customers,public.team_season_orders,public.stripe_season_events to service_role;
create function public.claim_season_order(p_user uuid,p_live boolean,p_base boolean,p_coaches integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=public.verified_team_for_operation(p_user,false); cutoff timestamptz; existing public.team_season_orders%rowtype; have_base boolean; have_coaches integer;
begin
 perform 1 from public.organizations where id=o for update;
 if not exists(select 1 from public.team_memberships where organization_id=o and user_id=p_user and role in ('owner','team_admin') and status='active') then raise exception 'billing administrator required' using errcode='42501'; end if;
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) then raise exception 'verified account required' using errcode='42501'; end if;
 if p_live is null or p_base is null or p_coaches is null or p_coaches<0 or p_coaches>2 or not(p_base or p_coaches>0) then raise exception 'invalid purchase'; end if;
 cutoff:=(date_trunc('year',now() at time zone 'America/Toronto')+interval '8 months') at time zone 'America/Toronto';
 if cutoff<=now() then cutoff:=(date_trunc('year',now() at time zone 'America/Toronto')+interval '1 year 8 months') at time zone 'America/Toronto'; end if;
 if cutoff<now()+interval '31 minutes' then raise exception 'Season checkout reopens September 1'; end if;
  select * into existing from public.team_season_orders where organization_id=o and livemode=p_live and status='pending' for update;
  if found then
   if existing.base<>p_base or existing.coach_quantity<>p_coaches then raise exception 'Finish or cancel the existing checkout before changing your selection'; end if;
   return to_jsonb(existing);
  end if;
 select coalesce(bool_or(base),false),coalesce(sum(coach_quantity),0) into have_base,have_coaches from public.team_season_orders where organization_id=o and livemode=p_live and status='paid' and season_end=cutoff;
 if (p_base and have_base) or have_coaches+p_coaches>2 or (not p_base and not have_base) then raise exception 'Purchase does not match existing season access'; end if;
 insert into public.team_season_orders(organization_id,livemode,season_end,base,coach_quantity) values(o,p_live,cutoff,p_base,p_coaches) returning * into existing;
 return to_jsonb(existing);
end; $$;
-- The provider calls this only after reconciling Stripe for a lost create
-- response. Keep this separate from claim_season_order so that lookup cannot
-- be skipped by a stale row being released too early.
create function public.release_empty_season_order(p_order uuid,p_organization uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
 update public.team_season_orders set status='expired',updated_at=now(),sync_token=null,sync_until=null
 where id=p_order and organization_id=p_organization and status='pending' and session_id is null and created_at<=now()-interval '23 hours';
 return found;
end; $$;
create function public.begin_season_sync(p_order uuid,p_event text,p_token uuid) returns text language plpgsql security definer set search_path='' as $$
declare r public.team_season_orders%rowtype;
begin
 select * into r from public.team_season_orders where id=p_order for update;
 if not found then return 'unknown'; end if;
 if exists(select 1 from public.stripe_season_events where event_id=p_event) then return 'done'; end if;
 if r.sync_until>now() then return 'busy'; end if;
 update public.team_season_orders set sync_token=p_token,sync_until=now()+interval '2 minutes' where id=p_order;
 return 'claimed';
end; $$;
create function public.finish_season_sync(p_order uuid,p_event text,p_token uuid,p_status text,p_intent text) returns void language plpgsql security definer set search_path='' as $$
declare r public.team_season_orders%rowtype; base_end timestamptz; coach_end timestamptz; coaches integer;
begin
 select * into r from public.team_season_orders where id=p_order;
 if not found then raise exception 'order unavailable'; end if;
 perform 1 from public.organizations where id=r.organization_id for update;
 update public.team_season_orders set status=p_status,payment_intent_id=coalesce(p_intent,payment_intent_id),sync_token=null,sync_until=null,updated_at=now()
 where id=p_order and sync_token=p_token and sync_until>now();
 if not found then raise exception 'sync lease expired'; end if;
 -- A sandbox payment never changes real team access.
 if r.livemode then
  select max(season_end) filter(where base),max(season_end) filter(where coach_quantity>0) into base_end,coach_end from public.team_season_orders where organization_id=r.organization_id and livemode and status='paid' and season_end>now();
  select coalesce(sum(coach_quantity),0) into coaches from public.team_season_orders where organization_id=r.organization_id and livemode and status='paid' and season_end=coach_end;
  if coaches>2 then raise exception 'seat purchase capacity exceeded'; end if;
  insert into public.team_access(organization_id,paid_expires_at) values(r.organization_id,base_end) on conflict(organization_id) do update set paid_expires_at=excluded.paid_expires_at,updated_at=now();
  insert into public.curlcoach_module_entitlements(organization_id,expires_at,billing_seat_count,billing_expires_at) values(r.organization_id,now(),coaches,coach_end)
  on conflict(organization_id) do update set billing_seat_count=excluded.billing_seat_count,billing_expires_at=excluded.billing_expires_at,updated_at=now();
 end if;
 insert into public.stripe_season_events(event_id) values(p_event) on conflict do nothing;
 insert into public.audit_events(organization_id,action,subject_type,subject_identifier,metadata) values(r.organization_id,'billing.season.synchronized','season_order',p_order::text,jsonb_build_object('status',p_status,'live',r.livemode));
end; $$;
revoke all on function public.claim_season_order(uuid,boolean,boolean,integer),public.release_empty_season_order(uuid,uuid),public.begin_season_sync(uuid,text,uuid),public.finish_season_sync(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_season_order(uuid,boolean,boolean,integer),public.release_empty_season_order(uuid,uuid),public.begin_season_sync(uuid,text,uuid),public.finish_season_sync(uuid,text,uuid,text,text) to service_role;
notify pgrst,'reload schema';
commit;
