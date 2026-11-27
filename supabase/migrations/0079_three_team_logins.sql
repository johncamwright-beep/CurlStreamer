begin;
create or replace function public.check_team_login_limit() returns trigger language plpgsql set search_path='' as $$ begin
 if new.status in ('active','suspended') and (tg_op='INSERT' or old.status='removed' or new.organization_id<>old.organization_id) then
   perform 1 from public.organizations where id=new.organization_id for update;
   if (select count(*) from public.team_memberships where organization_id=new.organization_id and status in ('active','suspended') and id<>new.id)>=3 then
     raise exception 'team already has three logins' using errcode='23514';
   end if;
 end if;
 return new;
end $$;
create or replace function public.manage_team_member(p_user uuid,p_action text,p_email text default null,p_role text default null,p_id uuid default null,p_hash text default null,p_org uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o uuid:=public.member_manager_org(p_user,p_org); v_id uuid; begin
 perform 1 from public.organizations where id=o for update;
 -- Recheck after waiting: a concurrent owner action may have removed or demoted this actor.
 if public.member_manager_org(p_user,p_org)<>o then raise exception 'team administrator required' using errcode='42501'; end if;
 if p_action in ('invite','role') and (p_role is null or p_role not in ('team_admin','game_operator')) then raise exception 'invalid role' using errcode='22023'; end if;
 if p_action='invite' then
   if (select count(*) from public.team_member_invitations where organization_id=o and created_at>now()-interval '1 hour')>=10 then raise exception 'invitation hourly limit reached' using errcode='54000'; end if;
   if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid invite' using errcode='22023'; end if;
   if (select count(*) from public.team_memberships where organization_id=o and status<>'removed') + (select count(*) from public.team_member_invitations where organization_id=o and accepted_at is null and revoked_at is null and expires_at>now())>=3 then raise exception 'three logins already occupied or invited' using errcode='23514'; end if;
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
create or replace function public.list_team_members(p_user uuid,p_org uuid default null) returns jsonb language plpgsql security definer set search_path='' as $$ declare o uuid; begin
 if p_org is null then o:=public.verified_team_for_operation(p_user,false); else o:=public.member_manager_org(p_user,p_org); end if;
 return jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'email',u.email,'role',m.role,'status',m.status) order by m.created_at) from public.team_memberships m join auth.users u on u.id=m.user_id where m.organization_id=o and m.status<>'removed'),'[]'::jsonb),
 'invitation',(select jsonb_build_object('id',id,'email',email,'role',role,'expiresAt',expires_at) from public.team_member_invitations where organization_id=o and revoked_at is null and accepted_at is null and expires_at>now() order by created_at desc limit 1),
 'invitations',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'role',role,'expiresAt',expires_at) order by created_at desc) from public.team_member_invitations where organization_id=o and revoked_at is null and accepted_at is null and expires_at>now()),'[]'::jsonb),
 'canManage',public.is_platform_admin(p_user) or exists(select 1 from public.team_memberships where organization_id=o and user_id=p_user and status='active' and role in ('owner','team_admin')));
end $$;

commit;
