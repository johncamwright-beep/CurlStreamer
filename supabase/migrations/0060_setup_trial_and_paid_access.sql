begin;
-- Profiles are first created on verified sign-in. Returning users cannot restart this clock.
alter table public.user_profiles add column setup_trial_started_at timestamptz;
update public.user_profiles set setup_trial_started_at=created_at;
create function public.protect_setup_trial_start() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then new.setup_trial_started_at:=now();
 else new.setup_trial_started_at:=old.setup_trial_started_at; end if;
 return new;
end; $$;
create trigger setup_trial_clock before insert or update on public.user_profiles for each row execute function public.protect_setup_trial_start();
alter table public.team_access add column setup_trial_expires_at timestamptz, add column paid_expires_at timestamptz;
create function public.start_team_setup_trial() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.role='owner' and new.status='active' then
  insert into public.team_access(organization_id,setup_trial_expires_at)
  select new.organization_id,setup_trial_started_at+interval '7 days' from public.user_profiles where user_id=new.user_id
  on conflict(organization_id) do nothing;
 end if;
 return new;
end; $$;
create trigger team_setup_trial after insert or update on public.team_memberships for each row execute function public.start_team_setup_trial();
-- Existing pilot grants stay intact. No renewed trial for an existing account.
insert into public.team_access(organization_id,setup_trial_expires_at)
select m.organization_id,p.setup_trial_started_at+interval '7 days' from public.team_memberships m join public.user_profiles p on p.user_id=m.user_id where m.role='owner' and m.status='active' on conflict(organization_id) do nothing;
create function public.team_has_page_access(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.team_access where organization_id=p_org and (setup_trial_expires_at>now() or trial_expires_at>now() or paid_expires_at>now()));
$$;
create or replace function public.assert_team_broadcast_access(p_org uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.team_access where organization_id=p_org and (paid_expires_at>now() or trial_expires_at>now())) then
  raise exception 'paid subscription or pilot access required; setup trials cannot stream' using errcode='P0402';
 end if;
end; $$;
create function public.read_team_commercial_access(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid:=public.verified_team_for_operation(p_user,false); result jsonb;
begin
 select jsonb_build_object('setupExpiresAt',setup_trial_expires_at,'pilotExpiresAt',trial_expires_at,'paidExpiresAt',paid_expires_at,'pageEnabled',public.team_has_page_access(o),'streamEnabled',coalesce(paid_expires_at>now() or trial_expires_at>now(),false)) into result from public.team_access where organization_id=o;
 return coalesce(result,'{"pageEnabled":false,"streamEnabled":false}'::jsonb);
end; $$;
alter table public.curlcoach_module_entitlements add column billing_seat_count integer not null default 0 check(billing_seat_count between 0 and 2), add column billing_expires_at timestamptz;
create function public.effective_curlcoach_seats(p_org uuid) returns integer language sql stable security definer set search_path='' as $$
 select coalesce((select greatest(case when expires_at is null or expires_at>now() then seat_count else 0 end,case when billing_expires_at>now() and exists(select 1 from public.team_access a where a.organization_id=p_org and a.paid_expires_at>now()) then billing_seat_count else 0 end) from public.curlcoach_module_entitlements where organization_id=p_org),0);
$$;
revoke all on function public.protect_setup_trial_start(),public.start_team_setup_trial(),public.team_has_page_access(uuid),public.read_team_commercial_access(uuid),public.effective_curlcoach_seats(uuid) from public,anon,authenticated;
grant execute on function public.team_has_page_access(uuid),public.read_team_commercial_access(uuid) to service_role;
create or replace function public.enforce_curlcoach_seats() returns trigger language plpgsql security definer set search_path = '' as $$
declare capacity integer;
begin
  select public.effective_curlcoach_seats(new.organization_id) into capacity from public.curlcoach_module_entitlements
  where organization_id=new.organization_id for update;
  if coalesce(capacity,0)=0 then raise exception 'active CurlCoach licence required' using errcode='42501'; end if;
  if (new.expires_at is null or new.expires_at>now()) and
    (select count(*) from public.curlcoach_coach_access where organization_id=new.organization_id
     and user_id<>new.user_id and (expires_at is null or expires_at>now())) >= capacity then
    raise exception 'all CurlCoach seats are assigned' using errcode='23514';
  end if;
  return new;
end; $$;


create or replace function public.read_team_curlcoach(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; can_manage boolean; result jsonb;
begin
  o:=public.verified_team_for_operation(p_actor,false);
  select role='owner' into can_manage from public.team_memberships where organization_id=o and user_id=p_actor and status='active';
  select jsonb_build_object(
    'enabled', public.effective_curlcoach_seats(o)>0,
    'seats',public.effective_curlcoach_seats(o),'expiresAt',e.expires_at
  ) into result from public.curlcoach_module_entitlements e where e.organization_id=o;
  return coalesce(result,jsonb_build_object('enabled',false,'seats',0,'expiresAt',null)) ||
    jsonb_build_object('canManage',coalesce(can_manage,false),'members',coalesce((
      select jsonb_agg(jsonb_build_object('id',m.id,'email',u.email,'role',m.role,
        'assigned',exists(select 1 from public.curlcoach_coach_access a where a.organization_id=o and a.user_id=m.user_id and (a.expires_at is null or a.expires_at>now())))
        order by m.role,u.email)
      from public.team_memberships m join auth.users u on u.id=m.user_id
      join public.user_profiles p on p.user_id=m.user_id
      where m.organization_id=o and m.status='active' and p.status='active' and u.email_confirmed_at is not null
    ),'[]'::jsonb));
end; $$;

create or replace function public.assign_team_curlcoach(p_actor uuid,p_membership_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; capacity integer; expiration timestamptz; targets uuid[];
begin
  o:=public.verified_team_for_operation(p_actor,false);
  perform 1 from public.organizations where id=o for update;
  perform public.verified_team_for_operation(p_actor,false);
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null) or not exists(select 1 from public.team_memberships where organization_id=o and user_id=p_actor and status='active' and role='owner') then
    raise exception 'team owner required' using errcode='42501';
  end if;
  select public.effective_curlcoach_seats(o),null::timestamptz into capacity,expiration from public.curlcoach_module_entitlements where organization_id=o for update;
  if capacity is null then raise exception 'CurlCoach licence required' using errcode='42501'; end if;
  if p_membership_ids is null or cardinality(p_membership_ids)<>(select count(distinct id) from unnest(p_membership_ids) id) then
    raise exception 'invalid assignments' using errcode='22023';
  end if;
  if cardinality(p_membership_ids)>capacity or (cardinality(p_membership_ids)>0 and expiration<=now()) then
    raise exception 'not enough active licences' using errcode='23514';
  end if;
  select coalesce(array_agg(m.user_id),'{}'::uuid[]) into targets
  from public.team_memberships m join auth.users u on u.id=m.user_id join public.user_profiles p on p.user_id=m.user_id
  where m.organization_id=o and m.status='active' and m.id=any(p_membership_ids) and p.status='active' and u.email_confirmed_at is not null;
  if cardinality(targets)<>cardinality(p_membership_ids) then raise exception 'accepted active team members required' using errcode='42501'; end if;
  delete from public.curlcoach_coach_access where organization_id=o and not(user_id=any(targets));
  insert into public.curlcoach_coach_access(organization_id,user_id,expires_at,granted_by_user_id)
  select o,t,null,p_actor from unnest(targets) t
  on conflict(organization_id,user_id) do update set expires_at=null,granted_by_user_id=p_actor,updated_at=now();
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_actor,o,'curlcoach.seats.assigned','organization',o::text,jsonb_build_object('membership_ids',p_membership_ids,'seats',capacity));
  return public.read_team_curlcoach(p_actor);
end; $$;


create or replace function public.assert_curlcoach_actor(
  p_actor_user_id uuid,
  p_organization_id uuid,
  p_game_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users u
    join public.user_profiles p on p.user_id = u.id and p.status = 'active'
    join public.team_memberships m on m.user_id = u.id
      and m.organization_id = p_organization_id and m.status = 'active'
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'active team account required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.games
    where id = p_game_id and organization_id = p_organization_id
  ) then
    raise exception 'game unavailable' using errcode = '42501';
  end if;
  if public.effective_curlcoach_seats(p_organization_id)=0 or (select count(*) from public.curlcoach_coach_access where organization_id=p_organization_id and (expires_at is null or expires_at>now()))>public.effective_curlcoach_seats(p_organization_id) then
    raise exception 'curlcoach entitlement required' using errcode = 'P0402';
  end if;
  if not exists (
    select 1 from public.curlcoach_coach_access
    where organization_id = p_organization_id and user_id = p_actor_user_id
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'explicit curlcoach access required' using errcode = '42501';
  end if;
end;
$$;

-- Listing an event must fail closed before its games are read. This deliberately
-- does not accept a game identifier, while command/read RPCs additionally bind
-- a private session to a game in this same organization.
create or replace function public.assert_curlcoach_access(
  p_actor_user_id uuid,
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor_user_id is null or not exists (
    select 1 from auth.users u
    join public.user_profiles p on p.user_id = u.id and p.status = 'active'
    join public.team_memberships m on m.user_id = u.id
      and m.organization_id = p_organization_id and m.status = 'active'
    where u.id = p_actor_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'active team account required' using errcode = '42501';
  end if;
  if public.effective_curlcoach_seats(p_organization_id)=0 or (select count(*) from public.curlcoach_coach_access where organization_id=p_organization_id and (expires_at is null or expires_at>now()))>public.effective_curlcoach_seats(p_organization_id) then
    raise exception 'curlcoach entitlement required' using errcode = 'P0402';
  end if;
  if not exists (
    select 1 from public.curlcoach_coach_access
    where organization_id = p_organization_id and user_id = p_actor_user_id
      and (expires_at is null or expires_at > now())
  ) then
    raise exception 'explicit curlcoach access required' using errcode = '42501';
  end if;
end;
$$;


create function public.list_available_team_pages(p_offset integer) returns table(slug text) language sql stable security definer set search_path='' as $$
 select p.slug from public.team_public_profiles p where p.settings->>'published'='true' and public.team_has_page_access(p.organization_id) order by p.slug offset greatest(p_offset,0) limit 1000;
$$;
revoke all on function public.list_available_team_pages(integer) from public,anon,authenticated;
grant execute on function public.list_available_team_pages(integer) to service_role;
notify pgrst,'reload schema';
commit;
