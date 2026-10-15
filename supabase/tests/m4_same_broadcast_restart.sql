-- Rollback-only fixture. No real team, video, provider or payment is touched.
begin;
do $$
declare
  org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); backup_owner uuid:=gen_random_uuid(); gid uuid:=gen_random_uuid();
  sid uuid; generation bigint; next_sid uuid; next_generation bigint;
  code text:=encode(gen_random_bytes(32),'hex'); challenge text:=encode(gen_random_bytes(32),'hex');
  bearer text:=encode(gen_random_bytes(32),'hex'); next_bearer text:=encode(gen_random_bytes(32),'hex');
  token uuid:=gen_random_uuid(); intent uuid:=gen_random_uuid(); next_intent uuid:=gen_random_uuid();
  journal jsonb; original_key uuid; original_generation bigint; row_intent public.m4_output_intents;
begin
  insert into public.organizations(id,name) values(org,'Rollback restart fixture');
  insert into auth.users(id,email,email_confirmed_at) values(owner_id,owner_id::text||'@restart.test',now());
  insert into public.user_profiles(user_id,display_name,status) values(owner_id,'Fixture owner','active');
  insert into public.team_memberships(organization_id,user_id,role,status) values(org,owner_id,'owner','active');
  insert into auth.users(id,email,email_confirmed_at) values(backup_owner,backup_owner::text||'@restart.test',now());
  insert into public.user_profiles(user_id,display_name,status) values(backup_owner,'Fixture backup owner','active');
  insert into public.team_memberships(organization_id,user_id,role,status) values(org,backup_owner,'owner','active');
  insert into public.games(id,organization_id,created_by,status,config)
    values(gid,org,owner_id,'active','{"eventName":"Fixture","homeName":"Home","awayName":"Away","youtubeTitle":"Fixture","youtubeVisibility":"unlisted","scheduledEnds":8}');
  insert into public.game_states(game_id,state) values(gid,'{"status":"active","scoreEvents":[]}');
  insert into public.broadcast_settings(organization_id,provider,encrypted_credentials,channel_id,channel_title,connection_status,connection_version)
    values(org,'youtube','opaque'::bytea,'fixture-channel','Fixture','connected',1);
  select x.session_id,x.generation into sid,generation from public.approve_m4_desktop_pairing(gid,owner_id,false,code,challenge) x;
  perform public.exchange_m4_desktop_pairing(gid,code,challenge,bearer);
  -- The fixture calls the private pre-subscription wrapper only to avoid
  -- creating a payment/subscription. All game, membership and output checks run.
  journal:=public.trial_legacy_claim_m4_broadcast_operation(gid,owner_id,false,'prepared',token);
  perform public.record_m4_broadcast_operation(gid,(journal->>'generation')::bigint,token,'prepared',
    p_youtube_broadcast_id=>'fixture-video',p_youtube_stream_id=>'fixture-stream',
    p_watch_url=>'https://www.youtube.com/watch?v=abcdefghijk',
    p_youtube_broadcast_create_state=>'ready',p_youtube_stream_create_state=>'ready');
  select session_key,operation_generation into original_key,original_generation from public.broadcast_sessions where game_id=gid;
  perform public.claim_m4_output_intent(gid,sid,generation,bearer,intent);
  perform public.consume_m4_output_delivery(gid,sid,generation,bearer,intent);
  perform public.stop_m4_desktop(gid,sid,generation,bearer);
  select * into row_intent from public.m4_output_intents where intent_id=intent;
  if public.m4_output_recovery_safe(row_intent) then raise exception 'Stop incorrectly proves sender expiry'; end if;
  begin
    perform public.approve_m4_desktop_pairing(gid,owner_id,false,encode(gen_random_bytes(32),'hex'),challenge);
    raise exception 'Unexpired delivered sender replaced';
  exception when sqlstate 'P0409' then null; end;
  begin
    perform public.trial_legacy_claim_m4_broadcast_operation(gid,owner_id,false,'prepared',gen_random_uuid());
    raise exception 'Unexpired output passed prepare';
  exception when sqlstate 'P0409' then null; end;
  update public.m4_desktop_sessions set lease_expires_at=clock_timestamp()-interval '10 seconds' where session_id=sid;
  if not public.m4_output_recovery_safe(row_intent) or public.m4_intent_is_retired(row_intent) then
    raise exception 'Local expiry confused with provider retirement'; end if;
  row_intent.generation:=generation+100;
  if public.m4_output_recovery_safe(row_intent) then raise exception 'Mismatched sender generation accepted'; end if;
  code:=encode(gen_random_bytes(32),'hex');
  select x.session_id,x.generation into next_sid,next_generation from public.approve_m4_desktop_pairing(gid,owner_id,false,code,challenge) x;
  if next_generation<>generation+1 then raise exception 'Pairing generation not advanced'; end if;
  perform public.exchange_m4_desktop_pairing(gid,code,challenge,next_bearer);
  journal:=public.trial_legacy_claim_m4_broadcast_operation(gid,owner_id,false,'prepared',gen_random_uuid());
  if not exists(select 1 from public.broadcast_sessions where game_id=gid and session_key=original_key
    and operation_generation=original_generation and youtube_broadcast_id='fixture-video' and youtube_stream_id='fixture-stream'
    and watch_url='https://www.youtube.com/watch?v=abcdefghijk') then raise exception 'Restart changed broadcast identity'; end if;
  begin
    perform public.consume_m4_output_delivery(gid,sid,generation,bearer,intent);
    raise exception 'Old target delivery replayed';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.heartbeat_m4_desktop(gid,sid,generation,bearer);
    raise exception 'Old sender renewed';
  exception when sqlstate '55000' then null; when sqlstate '42501' then null; end;
  perform public.claim_m4_output_intent(gid,next_sid,next_generation,next_bearer,next_intent);
  perform public.consume_m4_output_delivery(gid,next_sid,next_generation,next_bearer,next_intent);
  begin
    perform public.consume_m4_output_delivery(gid,next_sid,next_generation,next_bearer,next_intent);
    raise exception 'Fresh target delivered twice';
  exception when sqlstate '55000' then null; end;
  begin
    perform public.assert_m4_output_delivery(gid,next_sid,next_generation,bearer,next_intent);
    raise exception 'Wrong bearer accepted';
  exception when sqlstate '42501' then null; end;
  update public.team_memberships set status='removed' where organization_id=org and user_id=owner_id;
  begin
    perform public.assert_m4_output_delivery(gid,next_sid,next_generation,next_bearer,next_intent);
    raise exception 'Revoked owner accepted';
  exception when sqlstate '42501' then null; end;
  update public.team_memberships set status='active' where organization_id=org and user_id=owner_id;
  update public.m4_desktop_sessions set lease_expires_at=clock_timestamp()-interval '10 seconds' where session_id=next_sid;
  update public.broadcast_sessions set status='stopped',desired_state='stopped',lease_expires_at=null where game_id=gid;
  begin
    perform public.trial_legacy_claim_m4_broadcast_operation(gid,owner_id,false,'prepared',gen_random_uuid());
    raise exception 'Ended saved watch page replaced';
  exception when sqlstate '55000' then null; end;
  update public.game_states set state=jsonb_set(state,'{status}','"completed"') where game_id=gid;
  begin
    perform public.approve_m4_desktop_pairing(gid,owner_id,false,encode(gen_random_bytes(32),'hex'),challenge);
    raise exception 'Completed game approved';
  exception when sqlstate '55000' then null; end;
  if has_function_privilege('anon','public.m4_output_recovery_safe(public.m4_output_intents)','execute')
    or has_function_privilege('authenticated','public.m4_output_recovery_safe(public.m4_output_intents)','execute')
    or has_function_privilege('service_role','public.m4_output_recovery_safe(public.m4_output_intents)','execute') then
    raise exception 'Private recovery predicate exposed'; end if;
end $$;
rollback;
select 'PASS: same broadcast restart, expiry fence, fresh one-use authority, replay denial, revoked owner and completed game denial' as result;
