-- Rollback-only fixture: no existing game, device or session is modified.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); backup_owner uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid();
  device uuid:=gen_random_uuid(); invitation uuid:=gen_random_uuid(); expiry timestamptz:=now()+interval '10 minutes';
  registered jsonb; original jsonb; recovered jsonb; renewed jsonb; sid uuid; old_negotiation uuid; absolute_expiry timestamptz;
begin
  insert into public.organizations(id,name) values(org,'Rollback receiver recovery fixture');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id::text||'@camera.test',now()),(backup_owner,backup_owner::text||'@camera.test',now());
  insert into public.user_profiles(user_id,display_name,status) values(owner_id,'Fixture owner','active'),(backup_owner,'Fixture backup','active');
  insert into public.team_memberships(organization_id,user_id,role,status) values(org,owner_id,'owner','active'),(org,backup_owner,'owner','active');
  insert into public.games(id,organization_id,created_by,status,config) values(gid,org,owner_id,'active','{"eventName":"Fixture","homeName":"Home","awayName":"Away","youtubeTitle":"Fixture","youtubeVisibility":"unlisted","scheduledEnds":8}');
  insert into public.game_states(game_id,state) values(gid,'{"status":"active","claims":{},"scoreEvents":[],"connections":{}}');
  perform public.prepare_game_role_invitation(gid,'camera-home',invitation,expiry);
  perform public.claim_game_role(gid,'camera-home',invitation,1,device,expiry);
  registered:=public.m2_studio_action(gid,'camera-home','register','receiver',p_organization_id=>org);
  sid:=(registered->>'sessionId')::uuid;
  original:=public.m2_studio_action(gid,'camera-home','begin','camera',p_device_id=>device,p_assignment_generation=>1);
  old_negotiation:=(original->>'negotiationId')::uuid;
  select expires_at into absolute_expiry from public.m2_studio_sessions where game_id=gid and camera_role='camera-home';
  update public.m2_studio_sessions set receiver_seen_at=now()-interval '45 seconds' where game_id=gid;
  begin
    perform public.m2_studio_action(gid,'camera-home','begin','camera',p_device_id=>device,p_assignment_generation=>1);
    raise exception 'Phone resurrected expired Studio heartbeat';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',gen_random_uuid(),p_organization_id=>org);
    raise exception 'Replaced receiver session accepted';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',sid,p_organization_id=>gen_random_uuid());
    raise exception 'Wrong organization accepted';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',sid,old_negotiation,p_organization_id=>org);
    raise exception 'Old media negotiation resumed';
  exception when sqlstate '55000' then null; end;
  recovered:=public.m2_studio_action(gid,'camera-home','check','receiver',sid,p_organization_id=>org);
  if (recovered->>'sessionId')::uuid <> sid or recovered->>'negotiationId' is not null then raise exception 'Recovery did not fence old negotiation'; end if;
  if exists(select 1 from public.m2_studio_sessions where game_id=gid and expires_at <> absolute_expiry) then raise exception 'Absolute authority extended'; end if;
  renewed:=public.m2_studio_action(gid,'camera-home','begin','camera',p_device_id=>device,p_assignment_generation=>1);
  if (renewed->>'negotiationId')::uuid=old_negotiation then raise exception 'Old negotiation reused'; end if;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','camera',sid,old_negotiation,device,1);
    raise exception 'Expired camera negotiation accepted';
  exception when sqlstate '55000' then null; end;
  perform public.m2_studio_action(gid,'camera-home','stop','receiver',sid,p_organization_id=>org);
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',sid,p_organization_id=>org);
    raise exception 'Explicitly stopped receiver revived';
  exception when sqlstate '55000' then null; end;
  registered:=public.m2_studio_action(gid,'camera-home','register','receiver',p_organization_id=>org); sid:=(registered->>'sessionId')::uuid;
  update public.m2_studio_sessions set expires_at=now()-interval '1 second' where game_id=gid;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',sid,p_organization_id=>org);
    raise exception 'Expired scope revived';
  exception when sqlstate '55000' then null; end;
  registered:=public.m2_studio_action(gid,'camera-home','register','receiver',p_organization_id=>org); sid:=(registered->>'sessionId')::uuid;
  update public.games set completed_at=now(),completion_id=gen_random_uuid(),status='completed' where id=gid;
  begin
    perform public.m2_studio_action(gid,'camera-home','check','receiver',sid,p_organization_id=>org);
    raise exception 'Completed game revived';
  exception when sqlstate '55000' then null; end;
  if has_function_privilege('anon','public.m2_studio_action(uuid,text,text,text,uuid,uuid,uuid,bigint,uuid)','execute') or has_function_privilege('authenticated','public.m2_studio_action(uuid,text,text,text,uuid,uuid,uuid,bigint,uuid)','execute') then raise exception 'Receiver RPC exposed publicly'; end if;
end;
$$;
rollback;
select 'Receiver recovery fixture passed; all fixtures rolled back' as result;
