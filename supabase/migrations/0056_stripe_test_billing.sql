begin;
-- Sandbox billing is deliberately separate from team_access. No test payment
-- can grant or revoke production broadcast access.
create table public.team_test_billing (
  organization_id uuid primary key references public.organizations(id),
  customer_id text unique not null check(customer_id ~ '^cus_'),
  subscription jsonb,
  checkout_key uuid,
  checkout_until timestamptz,
  sync_token uuid,
  sync_until timestamptz,
  updated_at timestamptz not null default now()
);
create table public.stripe_test_events (
  event_id text primary key,
  customer_id text not null references public.team_test_billing(customer_id),
  processed_at timestamptz not null default now()
);
alter table public.team_test_billing enable row level security;
alter table public.stripe_test_events enable row level security;
revoke all on public.team_test_billing, public.stripe_test_events from public,anon,authenticated;
grant all on public.team_test_billing, public.stripe_test_events to service_role;

create function public.claim_test_checkout(p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user,true); v_row public.team_test_billing%rowtype;
begin
  select * into v_row from public.team_test_billing where organization_id=v_org for update;
  if not found then raise exception 'billing unavailable'; end if;
  perform public.verified_team_for_operation(p_user,true);
  -- Never rotate solely because time elapsed: an earlier API request may have
  -- created its Checkout Session later. Only a verified expired session resets it.
  if v_row.checkout_key is not null then return v_row.checkout_key; end if;
  update public.team_test_billing set checkout_key=gen_random_uuid(),checkout_until=now()+interval '25 hours'
    where organization_id=v_org returning checkout_key into v_row.checkout_key;
  return v_row.checkout_key;
end $$;

create function public.reset_test_checkout(p_user uuid,p_key uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.verified_team_for_operation(p_user,true);
begin
  update public.team_test_billing set checkout_key=null,checkout_until=null where organization_id=v_org and checkout_key=p_key;
end $$;
revoke all on function public.reset_test_checkout(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reset_test_checkout(uuid,uuid) to service_role;

-- Serialize read-current-state reconciliation, including out-of-order events.
create function public.begin_test_billing_sync(p_customer text,p_event text,p_token uuid)
returns text language plpgsql security definer set search_path='' as $$
declare v_row public.team_test_billing%rowtype;
begin
  select * into v_row from public.team_test_billing where customer_id=p_customer for update;
  if not found then return 'unknown'; end if;
  if exists(select 1 from public.stripe_test_events where event_id=p_event) then return 'done'; end if;
  if v_row.sync_until>now() then return 'busy'; end if;
  update public.team_test_billing set sync_token=p_token,sync_until=now()+interval '2 minutes' where customer_id=p_customer;
  return 'claimed';
end $$;
create function public.finish_test_billing_sync(p_customer text,p_event text,p_token uuid,p_subscription jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.team_test_billing set subscription=p_subscription,sync_token=null,sync_until=null,updated_at=now()
    where customer_id=p_customer and sync_token=p_token and sync_until>now();
  if not found then raise exception 'sync lease expired'; end if;
  insert into public.stripe_test_events(event_id,customer_id) values(p_event,p_customer) on conflict do nothing;
end $$;
revoke all on function public.claim_test_checkout(uuid),public.begin_test_billing_sync(text,text,uuid),public.finish_test_billing_sync(text,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.claim_test_checkout(uuid),public.begin_test_billing_sync(text,text,uuid),public.finish_test_billing_sync(text,text,uuid,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
