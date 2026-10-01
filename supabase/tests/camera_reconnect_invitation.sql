-- Rollback-only fixture, never touches an existing game or camera.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); backup_owner uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid();
  device uuid:=gen_random_uuid(); invitation uuid:=gen_random_uuid(); renewal uuid:=gen_random_uuid();
  prepared jsonb; before_state jsonb; after_state jsonb; expiry timestamptz:=now()+interval '10 minutes';
begin
  insert into public.organizations(id,name) values(org,'Rollback camera renewal fixture');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id::text||'@camera.test',now()),(backup_owner,backup_owner::text||'@camera.test',now());
  insert into public.user_profiles(user_id,display_name,status) values(owner_id,'Fixture owner','active'),(backup_owner,'Fixture backup','active');
  insert into public.team_memberships(organization_id,user_id,role,status) values(org,owner_id,'owner','active'),(org,backup_owner,'owner','active');
  insert into public.games(id,organization_id,created_by,status,config) values(gid,org,owner_id,'active','{"eventName":"Fixture","homeName":"Home","awayName":"Away","youtubeTitle":"Fixture","youtubeVisibility":"unlisted","scheduledEnds":8}');
  insert into public.game_states(game_id,state) values(gid,'{"status":"active","claims":{},"scoreEvents":[],"connections":{}}');
  perform public.prepare_game_role_invitation(gid,'camera-away',invitation,expiry);
  perform public.claim_game_role(gid,'camera-away',invitation,1,device,expiry);
  select state into before_state from public.game_states where game_id=gid;
  prepared:=public.prepare_game_camera_reconnect(gid,'camera-away',renewal,expiry);
  if prepared->>'deviceId' <> device::text or (prepared->>'generation')::bigint <> 1 then raise exception 'Incorrect renewal binding'; end if;
  perform public.claim_game_role(gid,'camera-away',renewal,1,device,expiry);
  perform public.claim_game_role(gid,'camera-away',renewal,1,device,expiry);
  select state into after_state from public.game_states where game_id=gid;
  if before_state <> after_state then raise exception 'Renewal changed game or assignment'; end if;
  begin
    perform public.claim_game_role(gid,'camera-away',renewal,1,gen_random_uuid(),expiry);
    raise exception 'Different device accepted';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.prepare_game_camera_reconnect(gid,'camera-home',gen_random_uuid(),expiry);
    raise exception 'Unassigned camera accepted';
  exception when sqlstate '55000' then null; end;
  update public.game_invitations set expires_at=now()-interval '1 second' where id=renewal;
  begin
    perform public.claim_game_role(gid,'camera-away',renewal,1,device,expiry);
    raise exception 'Expired renewal accepted';
  exception when sqlstate '55000' then null; end;
  renewal:=gen_random_uuid();
  perform public.prepare_game_camera_reconnect(gid,'camera-away',renewal,expiry);
  perform public.release_game_role(gid,'camera-away',device::text,1);
  begin
    perform public.claim_game_role(gid,'camera-away',renewal,1,device,expiry);
    raise exception 'Released assignment reclaimed';
  exception when sqlstate '55000' then null; end;
  perform public.prepare_game_role_invitation(gid,'camera-away',gen_random_uuid(),expiry);
  update public.games set completed_at=now(),completion_id=gen_random_uuid(),status='completed' where id=gid;
  begin
    perform public.prepare_game_camera_reconnect(gid,'camera-away',gen_random_uuid(),expiry);
    raise exception 'Completed game accepted';
  exception when sqlstate '55000' then null; end;
  if has_function_privilege('anon','public.prepare_game_camera_reconnect(uuid,text,uuid,timestamptz)','execute')
    or has_function_privilege('authenticated','public.prepare_game_camera_reconnect(uuid,text,uuid,timestamptz)','execute') then
    raise exception 'Reconnect RPC exposed publicly';
  end if;
end;
$$;
rollback;
select 'Camera renewal fixture passed; all fixtures rolled back' as result;
