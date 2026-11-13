-- Run as a database administrator after applying the platform migrations.
-- All disposable accounts, invitations and codes are rolled back.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); operator_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); org uuid; invite uuid; member_id uuid; role_id uuid; game_id uuid:=gen_random_uuid();
begin
insert into auth.users(id,email,email_confirmed_at,created_at,updated_at) values(owner_id,owner_id::text||'@example.invalid',now(),now(),now()),(operator_id,operator_id::text||'@example.invalid',now(),now(),now()),(other_id,other_id::text||'@example.invalid',now(),now(),now());
insert into public.user_profiles(user_id,display_name) values(owner_id,'Validation owner'),(operator_id,'Validation operator'),(other_id,'Validation third');
select organization_id into org from public.create_first_team(owner_id,'Rollback validation team');
invite:=public.manage_team_member(owner_id,'invite',operator_id::text||'@example.invalid','game_operator',null,repeat('d',64));
begin perform public.manage_team_member(owner_id,'invite',other_id::text||'@example.invalid','team_admin',null,repeat('e',64)); raise exception 'pending invitation failed to reserve seat'; exception when check_violation then null; end;
begin perform public.accept_team_member_invitation(other_id,repeat('d',64)); raise exception 'wrong recipient accepted'; exception when invalid_parameter_value then null; end;
perform public.accept_team_member_invitation(operator_id,repeat('d',64));
perform public.accept_team_member_invitation(operator_id,repeat('d',64));
if (select count(*) from public.team_memberships where organization_id=org and status='active')<>2 then raise exception 'wrong login count'; end if;
if public.verified_game_operator(operator_id)<>org then raise exception 'operator missing game access'; end if;
perform public.create_team_game(operator_id,org,game_id,'{"youtubeEnabled":true}'::jsonb,'{}'::jsonb);
perform 1 from public.authorize_game_broadcast_actor(game_id,operator_id,false);
perform 1 from public.authorize_game_completion_actor(game_id,operator_id,false);
insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,connection_status,connection_version) values(org,'youtube',decode('01','hex'),'validation-channel','connected',1);
if (select count(*) from public.get_scheduled_youtube_credentials(operator_id,game_id))<>1 then raise exception 'operator cannot schedule connected YouTube game'; end if;
begin perform public.get_youtube_credentials(operator_id); raise exception 'operator got account credential management'; exception when insufficient_privilege then null; end;
begin perform public.get_scheduled_youtube_credentials(operator_id,gen_random_uuid()); raise exception 'operator got foreign game credentials'; exception when insufficient_privilege then null; end;
update public.team_memberships set status='suspended' where user_id=operator_id and organization_id=org;
begin perform public.get_scheduled_youtube_credentials(operator_id,game_id); raise exception 'suspended member retained YouTube access'; exception when sqlstate 'P0001' then null; end;
update public.team_memberships set status='active' where user_id=operator_id and organization_id=org;
if has_function_privilege('authenticated','public.get_scheduled_youtube_credentials(uuid,uuid)','EXECUTE') then raise exception 'browser credential privilege leak'; end if;
begin perform public.verified_team_for_operation(operator_id,true); raise exception 'operator got team administration'; exception when insufficient_privilege then null; end;
begin perform public.manage_team_member(operator_id,'invite',other_id::text||'@example.invalid','team_admin',null,repeat('e',64)); raise exception 'operator invited'; exception when insufficient_privilege then null; end;
begin insert into public.team_memberships(organization_id,user_id,role) values(org,other_id,'team_admin'); raise exception 'third login accepted'; exception when check_violation then null; end;
begin perform public.platform_account_overview(operator_id); raise exception 'ordinary account read platform'; exception when insufficient_privilege then null; end;
select id into role_id from public.platform_roles where name='super_admin';
insert into public.user_platform_roles(user_id,role_id) values(owner_id,role_id);
perform public.platform_account_overview(owner_id);
perform public.platform_issue_trial_codes(owner_id,array[repeat('f',64)],now()+interval '1 day');
begin perform public.platform_manage_account(owner_id,'suspend',owner_id); raise exception 'admin suspended itself'; exception when check_violation then null; end;
select id into member_id from public.team_memberships where user_id=operator_id and organization_id=org;
perform public.manage_team_member(owner_id,'role',null,'team_admin',member_id);
if public.member_manager_org(operator_id)<>org then raise exception 'full access role not applied'; end if;
perform public.manage_team_member(owner_id,'remove',null,null,member_id);
begin perform public.verified_game_operator(operator_id); raise exception 'removed member retained access'; exception when sqlstate 'P0001' then null; end;
if has_function_privilege('authenticated','public.platform_account_overview(uuid)','EXECUTE') or has_table_privilege('authenticated','public.team_member_invitations','SELECT') then raise exception 'browser privilege leak'; end if;
end $$;
select 'Admin and invitation permissions, roles, two-login limit, recipient binding and audit actions passed. Rolled back.' as result;
rollback;
