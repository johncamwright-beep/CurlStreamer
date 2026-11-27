begin;
-- Contact details belong to platform administration, never public team profiles.
create table public.pilot_accounts (
 id uuid primary key default gen_random_uuid(),
 email text not null unique check(email=lower(trim(email))),
 administrator_name text not null check(length(administrator_name) between 1 and 100),
 phone text not null check(length(phone) between 7 and 40),
 team_name text not null check(length(team_name) between 1 and 100),
 user_id uuid unique references auth.users(id),
 organization_id uuid unique references public.organizations(id),
 expires_at timestamptz not null,
 coach_seats integer not null check(coach_seats between 0 and 3),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 activated_at timestamptz,
 revoked_at timestamptz,
 email_status text not null default 'not_sent' check(email_status in ('not_sent','sending','accepted','failed','unknown')),
 email_attempt uuid,
 email_attempted_at timestamptz
);
alter table public.pilot_accounts enable row level security;
revoke all on public.pilot_accounts from public,anon,authenticated;
grant select on public.pilot_accounts to service_role;

create function public.prepare_pilot_account(p_actor uuid,p_email text,p_name text,p_phone text,p_team text,p_expires timestamptz,p_seats integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pilot_accounts;
begin
 perform public.require_platform_admin(p_actor);
 if p_expires<=now() or p_expires>now()+interval '2 years' then raise exception 'Invalid expiry'; end if;
 perform pg_advisory_xact_lock(hashtextextended(lower(trim(p_email)),0));
 select * into r from public.pilot_accounts where email=lower(trim(p_email));
 if found then raise exception 'Pilot already exists; use its resend or access controls' using errcode='23505'; end if;
 if exists(select 1 from auth.users where lower(email)=lower(trim(p_email))) then raise exception 'Existing account requires support; no password was changed' using errcode='23505'; end if;
 insert into public.pilot_accounts(email,administrator_name,phone,team_name,expires_at,coach_seats,created_by)
 values(lower(trim(p_email)),trim(p_name),trim(p_phone),trim(p_team),p_expires,p_seats,p_actor) returning * into r;
 insert into public.audit_events(actor_user_id,action,subject_type,subject_identifier) values(p_actor,'pilot.created','pilot',r.id::text);
 return to_jsonb(r);
end $$;

-- Recoverable provisioning: only a user created for this exact pilot may attach.
create function public.provision_pilot_account(p_actor uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.pilot_accounts; u uuid; o uuid;
begin
 perform public.require_platform_admin(p_actor);
 select * into r from public.pilot_accounts where id=p_id for update;
 if not found or r.revoked_at is not null or r.expires_at<=now() then raise exception 'Pilot unavailable'; end if;
 if r.organization_id is not null then return to_jsonb(r); end if;
 select id into u from auth.users where lower(email)=r.email and raw_app_meta_data->>'pilot_id'=r.id::text and raw_app_meta_data->>'pilot_password_required'='true';
 if u is null then raise exception 'Pilot identity not yet created'; end if;
 if exists(select 1 from public.team_memberships where user_id=u) then raise exception 'Account already has a team'; end if;
 insert into public.user_profiles(user_id,display_name,status) values(u,r.administrator_name,'suspended') on conflict(user_id) do update set status='suspended';
 insert into public.organizations(name) values(r.team_name) returning id into o;
 insert into public.team_memberships(organization_id,user_id,role,status) values(o,u,'owner','active');
 insert into public.team_access(organization_id,trial_expires_at) values(o,r.expires_at) on conflict(organization_id) do update set trial_expires_at=excluded.trial_expires_at;
 if r.coach_seats>0 then
  insert into public.curlcoach_module_entitlements(organization_id,expires_at,seat_count,granted_by_user_id) values(o,r.expires_at,r.coach_seats,p_actor);
  insert into public.curlcoach_coach_access(organization_id,user_id,expires_at,granted_by_user_id) values(o,u,r.expires_at,p_actor);
 end if;
 update public.pilot_accounts set user_id=u,organization_id=o where id=r.id returning * into r;
 return to_jsonb(r);
end $$;

create function public.claim_pilot_email(p_actor uuid,p_id uuid)
returns setof public.pilot_accounts language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_admin(p_actor);
 return query update public.pilot_accounts set email_status='sending',email_attempt=gen_random_uuid(),email_attempted_at=now()
 where id=p_id and activated_at is null and revoked_at is null and expires_at>now()
 and (email_status<>'sending' or email_attempted_at<now()-interval '5 minutes') returning *;
end $$;
create function public.finish_pilot_email(p_id uuid,p_attempt uuid,p_status text)
returns void language sql security definer set search_path='' as $$
 update public.pilot_accounts set email_status=p_status where id=p_id and email_attempt=p_attempt and p_status in ('accepted','failed','unknown');
$$;
create function public.activate_pilot_account(p_user uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.pilot_accounts;
begin
 select * into r from public.pilot_accounts where user_id=p_user for update;
 if not found or r.organization_id is null or r.revoked_at is not null or r.expires_at<=now() or r.email_status='sending' then raise exception 'Pilot unavailable'; end if;
 if not exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'pilot_password_required'='false') then raise exception 'Password change required'; end if;
 if r.activated_at is null then
  update public.user_profiles set status='active' where user_id=p_user;
  update public.pilot_accounts set activated_at=now() where id=r.id;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier) values(p_user,r.organization_id,'pilot.activated','pilot',r.id::text);
 end if;
 return r.organization_id;
end $$;
create function public.manage_pilot_account(p_actor uuid,p_id uuid,p_expires timestamptz,p_revoke boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare r public.pilot_accounts;
begin
 perform public.require_platform_admin(p_actor);
 select * into r from public.pilot_accounts where id=p_id for update;
 if not found then raise exception 'Pilot unavailable'; end if;
 if not p_revoke and (p_expires<=now() or p_expires>now()+interval '2 years') then raise exception 'Invalid expiry'; end if;
 update public.pilot_accounts set expires_at=case when p_revoke then now() else p_expires end,revoked_at=case when p_revoke then now() else null end where id=p_id;
 update public.team_access set trial_expires_at=case when p_revoke then now() else p_expires end where organization_id=r.organization_id;
 update public.curlcoach_module_entitlements set expires_at=case when p_revoke then now() else p_expires end where organization_id=r.organization_id;
 update public.curlcoach_coach_access set expires_at=case when p_revoke then now() else p_expires end where organization_id=r.organization_id;
 if p_revoke then update public.user_profiles set status='suspended' where user_id=r.user_id;
 elsif r.activated_at is not null then update public.user_profiles set status='active' where user_id=r.user_id; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier) values(p_actor,r.organization_id,case when p_revoke then 'pilot.revoked' else 'pilot.extended' end,'pilot',r.id::text);
end $$;
create function public.list_pilot_accounts(p_actor uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform public.require_platform_admin(p_actor);
 return coalesce((select jsonb_agg(item order by stamp desc) from (
 select p.created_at stamp,to_jsonb(p)-'email_attempt' || jsonb_build_object(
 'setup',u.raw_user_meta_data->'team_setup',
 'games',(select count(*) from public.games g where g.organization_id=p.organization_id and g.deleted_at is null),
 'chartedGames',(select count(*) from public.curlcoach_sessions s where s.organization_id=p.organization_id),
 'members',(select count(*) from public.team_memberships m where m.organization_id=p.organization_id and m.status='active')
 ) item from public.pilot_accounts p left join auth.users u on u.id=p.user_id order by p.created_at desc limit 100
 ) rows),'[]'::jsonb);
end $$;
do $$ declare f record; begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('prepare_pilot_account','provision_pilot_account','claim_pilot_email','finish_pilot_email','activate_pilot_account','manage_pilot_account','list_pilot_accounts') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
notify pgrst,'reload schema';
commit;
