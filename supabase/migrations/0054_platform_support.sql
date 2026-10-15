begin;
create function public.platform_account_overview(p_user uuid) returns jsonb language plpgsql security definer set search_path='' as $$ begin
 perform public.require_platform_admin(p_user);
 return jsonb_build_object('teams',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'name',o.name,'createdAt',o.created_at,'trialExpiresAt',a.trial_expires_at,
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'email',u.email,'role',m.role,'status',p.status)) from public.team_memberships m join auth.users u on u.id=m.user_id join public.user_profiles p on p.user_id=m.user_id where m.organization_id=o.id and m.status<>'removed'),'[]'::jsonb)) order by o.created_at desc) from public.organizations o left join public.team_access a on a.organization_id=o.id),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'email',u.email,'status',p.status,'createdAt',u.created_at) order by u.created_at desc) from auth.users u left join public.user_profiles p on p.user_id=u.id),'[]'::jsonb),
 'codes',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'expiresAt',c.expires_at,'revokedAt',c.revoked_at,'redeemedAt',c.redeemed_at,'teamName',o.name) order by c.created_at desc) from public.team_trial_codes c left join public.organizations o on o.id=c.redeemed_by_organization),'[]'::jsonb));
end $$;
create function public.platform_manage_account(p_user uuid,p_action text,p_target uuid,p_expires timestamptz default null) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_platform_admin(p_user);
 if p_action in ('suspend','activate') then
   if p_target=p_user or public.is_platform_admin(p_target) then raise exception 'platform administrators cannot be suspended here' using errcode='23514'; end if;
   update public.user_profiles set status=case when p_action='suspend' then 'suspended'::public.account_status else 'active'::public.account_status end,updated_at=now() where user_id=p_target;
   if not found then raise exception 'account unavailable' using errcode='22023'; end if;
 elsif p_action='trial' then
   if p_expires is null or p_expires>now()+interval '2 years' then raise exception 'invalid expiry' using errcode='22023'; end if;
   insert into public.team_access(organization_id,trial_expires_at) values(p_target,p_expires) on conflict(organization_id) do update set trial_expires_at=excluded.trial_expires_at,updated_at=now();
 elsif p_action='revokeCode' then
   update public.team_trial_codes set revoked_at=now() where id=p_target and redeemed_at is null;
   if not found then raise exception 'only unused codes can be revoked' using errcode='23514'; end if;
 elsif p_action='view' then
   if not exists(select 1 from public.organizations where id=p_target) then raise exception 'team unavailable' using errcode='22023'; end if;
 else raise exception 'invalid action' using errcode='22023'; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
 values(p_user,case when p_action in ('trial','view') then p_target else null end,'platform.'||p_action,'support',p_target::text,jsonb_build_object('expires_at',p_expires));
end $$;
create function public.platform_issue_trial_codes(p_user uuid,p_hashes text[],p_expires timestamptz) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_platform_admin(p_user);
 if cardinality(p_hashes) is null or cardinality(p_hashes)<1 or cardinality(p_hashes)>100 or p_expires is null or p_expires<=now() or p_expires>now()+interval '2 years' then raise exception 'invalid trial batch' using errcode='22023'; end if;
 insert into public.team_trial_codes(code_hash,expires_at) select unnest(p_hashes),p_expires;
 insert into public.audit_events(actor_user_id,action,subject_type,subject_identifier,metadata) values(p_user,'platform.trials_created','trial_batch',gen_random_uuid()::text,jsonb_build_object('count',cardinality(p_hashes),'expires_at',p_expires));
end $$;
create function public.platform_update_team(p_user uuid,p_org uuid,p_settings jsonb,p_publish boolean default false,p_logo text default null) returns void language plpgsql security definer set search_path='' as $$ begin
 perform public.require_platform_admin(p_user);
 perform public.update_team_public_profile(p_org,p_settings,p_publish);
 if p_logo is not null then update public.team_public_profiles set logo_url=p_logo where organization_id=p_org; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier) values(p_user,p_org,'platform.team_updated','team',p_org::text);
end $$;
do $$ declare f record; begin for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('platform_account_overview','platform_manage_account','platform_issue_trial_codes','platform_update_team') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
end loop; end $$;
notify pgrst,'reload schema';
commit;
