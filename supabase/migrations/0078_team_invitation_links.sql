-- The invitation email is a delivery/contact address. Possession of the one-use
-- link authorizes a verified account to join, irrespective of its login email.
begin;
create or replace function public.manage_team_member(p_user uuid,p_action text,p_email text default null,p_role text default null,p_id uuid default null,p_hash text default null,p_org uuid default null) returns uuid language plpgsql security definer set search_path='' as $$
declare o uuid:=public.member_manager_org(p_user,p_org); v_id uuid; begin
 perform 1 from public.organizations where id=o for update;
 -- Recheck after waiting: a concurrent owner action may have removed or demoted this actor.
 if public.member_manager_org(p_user,p_org)<>o then raise exception 'team administrator required' using errcode='42501'; end if;
 if p_action in ('invite','role') and (p_role is null or p_role not in ('team_admin','game_operator')) then raise exception 'invalid role' using errcode='22023'; end if;
 if p_action='invite' then
   if (select count(*) from public.team_member_invitations where organization_id=o and created_at>now()-interval '1 hour')>=10 then raise exception 'invitation hourly limit reached' using errcode='54000'; end if;
   if p_email is null or length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid invite' using errcode='22023'; end if;
   if (select count(*) from public.team_memberships where organization_id=o and status<>'removed')>=2 or exists(select 1 from public.team_member_invitations where organization_id=o and accepted_at is null and revoked_at is null and expires_at>now()) then raise exception 'second login already occupied or invited' using errcode='23514'; end if;
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
create or replace function public.accept_team_member_invitation(p_user uuid,p_hash text) returns uuid language plpgsql security definer set search_path='' as $$
declare i public.team_member_invitations%rowtype; e text; begin
 select lower(email) into e from auth.users where id=p_user and email_confirmed_at is not null;
 if e is null or not exists(select 1 from public.user_profiles where user_id=p_user and status='active') then raise exception 'verified active account required' using errcode='42501'; end if;
 select * into i from public.team_member_invitations where token_hash=p_hash;
 if not found then raise exception 'invitation unavailable' using errcode='22023'; end if;
 perform 1 from public.organizations where id=i.organization_id for update;
 select * into i from public.team_member_invitations where token_hash=p_hash for update;
 if i.revoked_at is not null or i.expires_at<=now() then raise exception 'invitation unavailable' using errcode='22023'; end if;
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


revoke all on function public.manage_team_member(uuid,text,text,text,uuid,text,uuid), public.accept_team_member_invitation(uuid,text) from public,anon,authenticated;
grant execute on function public.manage_team_member(uuid,text,text,text,uuid,text,uuid), public.accept_team_member_invitation(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
