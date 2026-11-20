begin;
alter table public.pilot_accounts add column existing_account boolean not null default false;

create function public.approve_existing_pilot(p_actor uuid,p_user uuid,p_name text,p_phone text,p_team text,p_expires timestamptz,p_seats integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users; r public.pilot_accounts; o uuid;
begin
 perform public.require_platform_admin(p_actor);
 if p_expires<=now() or p_expires>now()+interval '2 years' then raise exception 'Invalid expiry'; end if;
 -- Same lock as self-service team creation and invitation acceptance.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select * into u from auth.users where id=p_user for update;
 if not found or u.email_confirmed_at is null then raise exception 'Verified account required'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(u.email)),0));
 if exists(select 1 from public.pilot_accounts where user_id=p_user or email=lower(trim(u.email))) then raise exception 'Pilot already exists' using errcode='23505'; end if;
 if exists(select 1 from public.team_memberships where user_id=p_user) then raise exception 'Manage existing team instead' using errcode='23514'; end if;
 if not exists(select 1 from public.user_profiles where user_id=p_user and status='active') then raise exception 'Active account required'; end if;
 if u.raw_app_meta_data->>'pilot_password_required'='true' or u.raw_app_meta_data->>'pilot_setup_pending'='true' then raise exception 'Existing invitation must finish first'; end if;
 insert into public.organizations(name) values(trim(p_team)) returning id into o;
 insert into public.pilot_accounts(email,administrator_name,phone,team_name,user_id,organization_id,expires_at,coach_seats,created_by,activated_at,existing_account)
 values(lower(trim(u.email)),trim(p_name),trim(p_phone),trim(p_team),p_user,o,p_expires,p_seats,p_actor,now(),true) returning * into r;
 insert into public.team_memberships(organization_id,user_id,role,status) values(o,p_user,'owner','active');
 insert into public.team_access(organization_id,trial_expires_at) values(o,p_expires) on conflict(organization_id) do update set trial_expires_at=excluded.trial_expires_at;
 if p_seats>0 then
  insert into public.curlcoach_module_entitlements(organization_id,expires_at,seat_count,granted_by_user_id) values(o,p_expires,p_seats,p_actor);
  insert into public.curlcoach_coach_access(organization_id,user_id,expires_at,granted_by_user_id) values(o,p_user,p_expires,p_actor);
 end if;
 -- Password, email verification, and all auth application metadata remain unchanged.
 update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('team_setup',jsonb_build_object('organizationId',o,'step',1,'complete',false)) where id=p_user;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier) values(p_actor,o,'pilot.approved_existing','pilot',r.id::text);
 return to_jsonb(r);
end $$;

create function public.claim_pilot_approval_email(p_actor uuid,p_id uuid)
returns setof public.pilot_accounts language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_admin(p_actor);
 return query update public.pilot_accounts set email_status='sending',email_attempt=gen_random_uuid(),email_attempted_at=now()
 where id=p_id and existing_account and activated_at is not null and revoked_at is null and expires_at>now()
 and (email_status<>'sending' or email_attempted_at<now()-interval '5 minutes') returning *;
end $$;
revoke all on function public.approve_existing_pilot(uuid,uuid,text,text,text,timestamptz,integer),public.claim_pilot_approval_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.approve_existing_pilot(uuid,uuid,text,text,text,timestamptz,integer),public.claim_pilot_approval_email(uuid,uuid) to service_role;
create or replace function public.platform_account_overview(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform public.require_platform_admin(p_user);
 return jsonb_build_object('teams',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'createdAt',o.created_at,'trialExpiresAt',a.trial_expires_at,
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'email',u.email,'role',m.role,'status',p.status)) from public.team_memberships m join auth.users u on u.id=m.user_id join public.user_profiles p on p.user_id=m.user_id where m.organization_id=o.id and m.status<>'removed'),'[]'::jsonb)) order by o.created_at desc) from public.organizations o left join public.team_access a on a.organization_id=o.id),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'status',p.status,'createdAt',u.created_at,'name',p.display_name,'emailVerified',u.email_confirmed_at is not null,'pilotId',(select pa.id from public.pilot_accounts pa where pa.user_id=u.id),'pilotExpiresAt',(select pa.expires_at from public.pilot_accounts pa where pa.user_id=u.id)) order by u.created_at desc) from auth.users u left join public.user_profiles p on p.user_id=u.id),'[]'::jsonb),
 'codes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'expiresAt',c.expires_at,'revokedAt',c.revoked_at,'redeemedAt',c.redeemed_at,'teamName',o.name) order by c.created_at desc) from public.team_trial_codes c left join public.organizations o on o.id=c.redeemed_by_organization),'[]'::jsonb));
end $$;

notify pgrst,'reload schema';
commit;
