begin;
create function public.is_platform_admin(p_user uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_platform_roles ur join public.platform_roles r on r.id=ur.role_id
 join public.user_profiles p on p.user_id=ur.user_id join auth.users u on u.id=p.user_id
 where ur.user_id=p_user and r.name='super_admin' and p.status='active' and u.email_confirmed_at is not null)
$$;
create function public.require_platform_admin(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$ begin
 if not public.is_platform_admin(p_user) then raise exception 'platform administrator required' using errcode='42501'; end if;
end $$;
create table public.team_member_invitations(
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 email text not null, role public.team_membership_role not null check(role::text in ('team_admin','game_operator')),
 token_hash text unique not null check(token_hash ~ '^[a-f0-9]{64}$'),
 invited_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 expires_at timestamptz not null default(now()+interval '7 days'), revoked_at timestamptz, accepted_at timestamptz,
 accepted_by uuid references auth.users(id)
);
alter table public.team_member_invitations enable row level security;
revoke all on public.team_member_invitations from public,anon,authenticated;
grant select,insert,update on public.team_member_invitations to service_role;

create function public.check_team_login_limit() returns trigger language plpgsql set search_path='' as $$ begin
 if new.status in ('active','suspended') and (tg_op='INSERT' or old.status='removed' or new.organization_id<>old.organization_id) then
   perform 1 from public.organizations where id=new.organization_id for update;
   if (select count(*) from public.team_memberships where organization_id=new.organization_id and status in ('active','suspended') and id<>new.id)>=2 then
     raise exception 'team already has two logins' using errcode='23514';
   end if;
 end if;
 return new;
end $$;
create trigger team_login_limit before insert or update on public.team_memberships for each row execute function public.check_team_login_limit();

create function public.member_manager_org(p_user uuid,p_org uuid default null) returns uuid language plpgsql security definer set search_path='' as $$ declare o uuid; begin
 if p_org is not null then perform public.require_platform_admin(p_user); return p_org; end if;
 o:=public.verified_team_for_operation(p_user,false);
 if not exists(select 1 from auth.users where id=p_user and email_confirmed_at is not null) or not exists(select 1 from public.team_memberships where user_id=p_user and organization_id=o and status='active' and role in ('owner','team_admin')) then raise exception 'team administrator required' using errcode='42501'; end if;
 return o;
end $$;
create function public.list_team_members(p_user uuid,p_org uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$ declare o uuid; begin
 if p_org is null then o:=public.verified_team_for_operation(p_user,false); else o:=public.member_manager_org(p_user,p_org); end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'email',u.email,'role',m.role,'status',m.status) order by m.created_at) from public.team_memberships m join auth.users u on u.id=m.user_id where m.organization_id=o and m.status<>'removed'),'[]'::jsonb),
 'invitation',(select jsonb_build_object('id',id,'email',email,'role',role,'expiresAt',expires_at) from public.team_member_invitations where organization_id=o and revoked_at is null and accepted_at is null and expires_at>now() order by created_at desc limit 1),
 'canManage',public.is_platform_admin(p_user) or exists(select 1 from public.team_memberships where organization_id=o and user_id=p_user and status='active' and role in ('owner','team_admin')));
end $$;
create function public.manage_team_member(p_user uuid,p_action text,p_email text default null,p_role text default null,p_id uuid default null,p_hash text default null,p_org uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o uuid:=public.member_manager_org(p_user,p_org); v_id uuid; begin
 perform 1 from public.organizations where id=o for update;
 -- Recheck after waiting: a concurrent owner action may have removed or demoted this actor.
 if public.member_manager_org(p_user,p_org)<>o then raise exception 'team administrator required' using errcode='42501'; end if;
 if p_action in ('invite','role') and (p_role is null or p_role not in ('team_admin','game_operator')) then raise exception 'invalid role' using errcode='22023'; end if;
 if p_action='invite' then
   if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid invite' using errcode='22023'; end if;
   if (select count(*) from public.team_memberships where organization_id=o and status<>'removed')>=2 or exists(select 1 from public.team_member_invitations where organization_id=o and accepted_at is null and revoked_at is null and expires_at>now()) then raise exception 'second login already occupied or invited' using errcode='23514'; end if;
   if exists(select 1 from public.team_memberships m join auth.users u on u.id=m.user_id where lower(u.email)=lower(trim(p_email)) and m.status<>'removed') then raise exception 'email already belongs to a team' using errcode='23514'; end if;
   insert into public.team_member_invitations(organization_id,email,role,token_hash,invited_by) values(o,lower(trim(p_email)),p_role::public.team_membership_role,p_hash,p_user) returning id into v_id;
 elsif p_action='revokeInvite' then
   update public.team_member_invitations set revoked_at=now() where id=p_id and organization_id=o and accepted_at is null and revoked_at is null returning id into v_id;
 elsif p_action in ('remove','role') then
   update public.team_memberships set status=case when p_action='remove' then 'removed'::public.team_membership_status else status end,
     role=case when p_action='role' then p_role::public.team_membership_role else role end,updated_at=now()
     where id=p_id and organization_id=o and role<>'owner' and status<>'removed' returning id into v_id;
 else raise exception 'invalid action' using errcode='22023'; end if;
 if v_id is null then raise exception 'member or invitation unavailable' using errcode='42501'; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user,o,'team_access.'||p_action,'membership',v_id::text,jsonb_build_object('role',p_role));
 return v_id;
end $$;
create function public.accept_team_member_invitation(p_user uuid,p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.team_member_invitations%rowtype; e text; begin
 select lower(email) into e from auth.users where id=p_user and email_confirmed_at is not null;
 if e is null or not exists(select 1 from public.user_profiles where user_id=p_user and status='active') then raise exception 'verified active account required' using errcode='42501'; end if;
 select * into i from public.team_member_invitations where token_hash=p_hash;
 if not found then raise exception 'invitation unavailable' using errcode='22023'; end if;
 perform 1 from public.organizations where id=i.organization_id for update;
 select * into i from public.team_member_invitations where token_hash=p_hash for update;
 if i.email<>e or i.revoked_at is not null or i.expires_at<=now() then raise exception 'invitation unavailable' using errcode='22023'; end if;
 if i.accepted_by=p_user then return i.organization_id; end if;
 if i.accepted_at is not null then raise exception 'invitation unavailable' using errcode='22023'; end if;
 if not public.is_platform_admin(i.invited_by) and not exists(select 1 from public.team_memberships m join public.user_profiles p on p.user_id=m.user_id where m.user_id=i.invited_by and m.organization_id=i.organization_id and m.status='active' and m.role in ('owner','team_admin') and p.status='active') then raise exception 'invitation unavailable' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 if exists(select 1 from public.team_memberships where user_id=p_user and status<>'removed') then raise exception 'account already belongs to a team' using errcode='23514'; end if;
 insert into public.team_memberships(organization_id,user_id,role) values(i.organization_id,p_user,i.role);
 update public.team_member_invitations set accepted_at=now(),accepted_by=p_user where id=i.id;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier) values(p_user,i.organization_id,'team_access.accepted','invitation',i.id::text);
 return i.organization_id;
end $$;

-- All entry points are server-only; each independently verifies the real actor.
do $$ declare f record; begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('is_platform_admin','require_platform_admin','member_manager_org','list_team_members','manage_team_member','accept_team_member_invitation') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop; end $$;
notify pgrst,'reload schema';
commit;
