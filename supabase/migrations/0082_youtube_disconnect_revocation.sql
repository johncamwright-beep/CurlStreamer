-- Disconnect first fences new provider work, then the server revokes Google
-- authorization, then a matching completion removes the encrypted credential.
-- Failed/lost provider responses retain the credential and fence for retry.
begin;

alter table public.broadcast_settings
  add column youtube_disconnect_pending boolean not null default false,
  add column youtube_disconnect_operation_id uuid,
  add constraint youtube_disconnect_pending_check check (
    not youtube_disconnect_pending or (
      provider='youtube' and youtube_disconnect_operation_id is not null
      and encrypted_credentials is not null and connection_status='reconnect_required'
    )
  );

-- All existing session writers already lock the settings row after their game
-- locks. Share that row lock rather than introducing the opposite lock order.
create function public.assert_youtube_not_disconnecting(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare pending boolean;
begin
  select b.youtube_disconnect_pending into pending from public.broadcast_settings b
    where b.organization_id=p_organization_id and b.provider='youtube' for update;
  if coalesce(pending,false) then
    raise exception 'youtube disconnect pending' using errcode='55000';
  end if;
end $$;
revoke all on function public.assert_youtube_not_disconnecting(uuid)
  from public,anon,authenticated,service_role;

create function public.begin_youtube_disconnect(p_user_id uuid)
returns table(organization_id uuid,encrypted_credentials text,connection_version bigint,disconnect_operation_id uuid)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.youtube_team(p_user_id,true); v_b public.broadcast_settings;
begin
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':youtube',20));
  select * into v_b from public.broadcast_settings b
    where b.organization_id=v_org and b.provider='youtube' for update;
  if not found or v_b.encrypted_credentials is null then
    return query select v_org,null::text,coalesce(v_b.connection_version,0),null::uuid;
    return;
  end if;
  if exists(select 1 from public.broadcast_sessions s
    where s.organization_id=v_org and s.provider='youtube'
      and (s.status not in ('idle','stopped') or s.desired_state='live'))
    or exists(select 1 from public.games g where g.organization_id=v_org
      and g.youtube_scheduled_status='intent' and g.deleted_at is null
      and g.completed_at is null and g.status='active'
      and not exists(select 1 from public.broadcast_sessions s where s.game_id=g.id
        and s.provider='youtube' and s.status='stopped')) then
    raise exception 'youtube connection has an unfinished broadcast' using errcode='55000';
  end if;
  if not v_b.youtube_disconnect_pending then
    update public.broadcast_settings b set youtube_disconnect_pending=true,
      youtube_disconnect_operation_id=gen_random_uuid(),
      connection_status='reconnect_required',connection_version=b.connection_version+1,
      last_error_code='disconnect_pending',updated_at=now()
      where b.id=v_b.id returning * into v_b;
    delete from public.youtube_oauth_states where youtube_oauth_states.organization_id=v_org;
    insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
      values(p_user_id,v_org,'youtube.disconnect_requested','organization',v_org::text,
        jsonb_build_object('connection_version',v_b.connection_version));
  end if;
  return query select v_org,encode(v_b.encrypted_credentials,'base64'),
    v_b.connection_version,v_b.youtube_disconnect_operation_id;
end $$;

create function public.finish_youtube_disconnect(
  p_user_id uuid,p_expected_organization_id uuid,p_expected_version bigint,p_disconnect_operation_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.youtube_team(p_user_id,true); v_b public.broadcast_settings;
begin
  if v_org is distinct from p_expected_organization_id then
    raise exception 'youtube organization changed' using errcode='PT409';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':youtube',20));
  select * into v_b from public.broadcast_settings b
    where b.organization_id=v_org and b.provider='youtube' for update;
  if not found or p_disconnect_operation_id is null
    or v_b.youtube_disconnect_operation_id is distinct from p_disconnect_operation_id then
    raise exception 'youtube connection changed' using errcode='PT409';
  end if;
  -- Retain the completed operation ID until a new grant is connected. A
  -- duplicate completion is harmless, but may never clear a newer grant.
  if not v_b.youtube_disconnect_pending and v_b.encrypted_credentials is null
    and v_b.connection_status='disconnected' and v_b.connection_version=p_expected_version+1 then
    return v_b.connection_version;
  end if;
  if not v_b.youtube_disconnect_pending or v_b.connection_version is distinct from p_expected_version then
    raise exception 'youtube connection changed' using errcode='PT409';
  end if;
  if exists(select 1 from public.broadcast_sessions s where s.organization_id=v_org
    and s.provider='youtube' and (s.status not in ('idle','stopped') or s.desired_state='live')) then
    raise exception 'youtube connection has an unfinished broadcast' using errcode='55000';
  end if;
  update public.broadcast_settings b set encrypted_credentials=null,channel_id=null,channel_title=null,
    connection_status='disconnected',connection_version=b.connection_version+1,
    youtube_disconnect_pending=false,connected_by=null,connected_at=null,tested_at=null,
    last_error_code=null,updated_at=now() where b.id=v_b.id returning * into v_b;
  delete from public.youtube_oauth_states where youtube_oauth_states.organization_id=v_org;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,'youtube.disconnected','organization',v_org::text,
      jsonb_build_object('connection_version',v_b.connection_version));
  return v_b.connection_version;
end $$;
revoke all on function public.begin_youtube_disconnect(uuid),
  public.finish_youtube_disconnect(uuid,uuid,bigint,uuid) from public,anon,authenticated,service_role;
grant execute on function public.begin_youtube_disconnect(uuid),
  public.finish_youtube_disconnect(uuid,uuid,bigint,uuid) to service_role;

create function public.guard_youtube_disconnect_settings()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if old.youtube_disconnect_pending and not (
    new.youtube_disconnect_pending and new.encrypted_credentials is not distinct from old.encrypted_credentials
      and new.channel_id is not distinct from old.channel_id and new.connection_status='reconnect_required'
      and new.connection_version=old.connection_version
      and new.youtube_disconnect_operation_id=old.youtube_disconnect_operation_id
    or not new.youtube_disconnect_pending and new.encrypted_credentials is null
      and new.channel_id is null and new.connection_status='disconnected'
      and new.connection_version=old.connection_version+1
      and new.youtube_disconnect_operation_id=old.youtube_disconnect_operation_id
  ) then raise exception 'youtube disconnect pending' using errcode='55000'; end if;
  if not old.youtube_disconnect_pending and not new.youtube_disconnect_pending
    and new.encrypted_credentials is not null
    and new.encrypted_credentials is distinct from old.encrypted_credentials then
    new.youtube_disconnect_operation_id:=null;
  end if;
  return new;
end $$;
create trigger guard_youtube_disconnect_settings before update on public.broadcast_settings
  for each row when (old.provider='youtube') execute function public.guard_youtube_disconnect_settings();

create function public.guard_youtube_disconnect_session()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='youtube' and (new.status not in ('idle','stopped') or new.desired_state='live') then
    perform public.assert_youtube_not_disconnecting(new.organization_id);
  end if;
  return new;
end $$;
create trigger guard_youtube_disconnect_session before insert or update on public.broadcast_sessions
  for each row execute function public.guard_youtube_disconnect_session();

create function public.guard_youtube_disconnect_schedule()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.youtube_scheduled_status='intent' then
    perform public.assert_youtube_not_disconnecting(new.organization_id);
  end if;
  return new;
end $$;
create trigger guard_youtube_disconnect_schedule before insert or update of youtube_scheduled_status on public.games
  for each row execute function public.guard_youtube_disconnect_schedule();
revoke all on function public.guard_youtube_disconnect_settings(),
  public.guard_youtube_disconnect_session(),public.guard_youtube_disconnect_schedule()
  from public,anon,authenticated,service_role;

-- Preserve every existing authorization/lifecycle boundary and only inject the
-- pending check after authorization. Assert each anchor exists before editing.
do $fence$
declare signature text; definition text; anchor text; replacement text;
begin
  foreach signature in array array[
    'public.get_youtube_credentials(uuid)',
    'public.begin_youtube_oauth(uuid,text,timestamptz)',
    'public.finish_youtube_connection_test(uuid,uuid,bigint,boolean,text)',
    'public.visibility_legacy_get_scheduled_youtube_credentials(uuid,uuid)'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    anchor:=E'\nbegin\n';
    if position(anchor in definition)=0 then raise exception 'Missing disconnect fence anchor: %',signature; end if;
    definition:=replace(definition,anchor,anchor || E'  perform public.assert_youtube_not_disconnecting(v_org);\n');
    execute definition;
    execute 'alter function ' || signature || ' volatile';
  end loop;
  signature:='public.legacy_get_game_broadcast_session(uuid,uuid,boolean)';
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  anchor:='  select * into v_settings from public.broadcast_settings b';
  if position(anchor in definition)=0 then raise exception 'Missing manual-session credential fence'; end if;
  definition:=replace(definition,anchor,E'  perform public.assert_youtube_not_disconnecting(v_session.organization_id);\n' || anchor);
  execute definition;
  execute 'alter function ' || signature || ' volatile';

  signature:='public.legacy_claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid)';
  definition:=replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
  anchor:='  if p_desired_state = ''live'' then';
  if position(anchor in definition)=0 then raise exception 'Missing broadcast claim fence'; end if;
  definition:=replace(definition,anchor,E'  perform public.assert_youtube_not_disconnecting(v_game.organization_id);\n' || anchor);
  execute definition;
end $fence$;

-- The legacy destructive RPC must not bypass programmatic Google revocation.
revoke execute on function public.disconnect_youtube_connection(uuid) from service_role;
notify pgrst,'reload schema';
commit;

