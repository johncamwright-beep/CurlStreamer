begin;
alter table public.curlcoach_module_entitlements add column seat_count integer not null default 1 check (seat_count between 1 and 100);

do $$ begin
  if exists(select 1 from public.curlcoach_coach_access where expires_at is null or expires_at>now() group by organization_id having count(*)>1) then
    raise exception 'Review existing teams with multiple active coaches before assigning purchased seat counts';
  end if;
end; $$;

create function public.enforce_curlcoach_seats() returns trigger language plpgsql security definer set search_path = '' as $$
declare capacity integer;
begin
  select seat_count into capacity from public.curlcoach_module_entitlements
  where organization_id=new.organization_id and (expires_at is null or expires_at>now()) for update;
  if capacity is null then raise exception 'active CurlCoach licence required' using errcode='42501'; end if;
  if (new.expires_at is null or new.expires_at>now()) and
    (select count(*) from public.curlcoach_coach_access where organization_id=new.organization_id
     and user_id<>new.user_id and (expires_at is null or expires_at>now())) >= capacity then
    raise exception 'all CurlCoach seats are assigned' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger curlcoach_seat_limit before insert or update on public.curlcoach_coach_access
for each row execute function public.enforce_curlcoach_seats();

create function public.read_team_curlcoach(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; can_manage boolean; result jsonb;
begin
  o:=public.verified_team_for_operation(p_actor,false);
  select role='owner' into can_manage from public.team_memberships where organization_id=o and user_id=p_actor and status='active';
  select jsonb_build_object(
    'enabled', coalesce(e.expires_at is null or e.expires_at>now(),false),
    'seats',e.seat_count,'expiresAt',e.expires_at
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

create function public.assign_team_curlcoach(p_actor uuid,p_membership_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare o uuid; capacity integer; expiration timestamptz; targets uuid[];
begin
  o:=public.verified_team_for_operation(p_actor,false);
  perform 1 from public.organizations where id=o for update;
  perform public.verified_team_for_operation(p_actor,false);
  if not exists(select 1 from auth.users where id=p_actor and email_confirmed_at is not null) or not exists(select 1 from public.team_memberships where organization_id=o and user_id=p_actor and status='active' and role='owner') then
    raise exception 'team owner required' using errcode='42501';
  end if;
  select seat_count,expires_at into capacity,expiration from public.curlcoach_module_entitlements where organization_id=o for update;
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

create function public.set_curlcoach_seats(p_actor uuid,p_organization_id uuid,p_seats integer) returns void language plpgsql security definer set search_path='' as $$
begin
  perform public.require_platform_admin(p_actor);
  perform 1 from public.curlcoach_module_entitlements where organization_id=p_organization_id for update;
  if not found then raise exception 'set team entitlement first' using errcode='22023'; end if;
  if p_seats is null or p_seats<1 or p_seats>100 or p_seats<(select count(*) from public.curlcoach_coach_access where organization_id=p_organization_id and (expires_at is null or expires_at>now())) then
    raise exception 'unassign excess coaches before reducing seats' using errcode='23514';
  end if;
  update public.curlcoach_module_entitlements set seat_count=p_seats,updated_at=now() where organization_id=p_organization_id;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_actor,p_organization_id,'curlcoach.seats.set','organization',p_organization_id::text,jsonb_build_object('seats',p_seats));
end; $$;

revoke all on function public.enforce_curlcoach_seats(), public.read_team_curlcoach(uuid), public.assign_team_curlcoach(uuid,uuid[]), public.set_curlcoach_seats(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.read_team_curlcoach(uuid), public.assign_team_curlcoach(uuid,uuid[]), public.set_curlcoach_seats(uuid,uuid,integer) to service_role;
notify pgrst,'reload schema';
commit;

