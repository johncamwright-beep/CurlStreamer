-- Honor the saved YouTube visibility without replacing the existing lifecycle,
-- membership, subscription, channel, output-quarantine or once-only guards.
begin;

do $visibility$
declare signature text; definition text; old_guard text; new_guard text;
begin
  foreach signature in array array[
    'public.create_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb,jsonb)',
    'public.pre_quarantine_claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid)',
    'public.begin_m4_replacement_cycle(uuid,uuid,boolean,uuid)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if signature like 'public.create_scheduled%' then
      old_guard:='p_config->>''youtubeVisibility'' is distinct from ''unlisted''';
      new_guard:='coalesce(p_config->>''youtubeVisibility'','''') not in (''unlisted'',''public'',''private'')';
    elsif signature like 'public.pre_quarantine%' then
      old_guard:='v_game.config->>''youtubeVisibility'' is distinct from ''unlisted''';
      new_guard:='coalesce(v_game.config->>''youtubeVisibility'','''') not in (''unlisted'',''public'',''private'')';
    else
      old_guard:='v_g.config->>''youtubeVisibility'' is distinct from ''unlisted''';
      new_guard:='coalesce(v_g.config->>''youtubeVisibility'','''') not in (''unlisted'',''public'',''private'')';
    end if;
    if position(old_guard in definition)=0
      or position(old_guard in substring(definition from position(old_guard in definition)+length(old_guard)))>0 then
      raise exception 'Expected one YouTube visibility guard in %',signature;
    end if;
    definition:=replace(definition,old_guard,new_guard);
    definition:=replace(definition,'scheduled youtube requires unlisted visibility','invalid scheduled youtube visibility');
    definition:=replace(definition,'M4 requires unlisted visibility','invalid M4 youtube visibility');
    execute definition;
  end loop;
end $visibility$;

-- Validate canonical configuration on scheduling retries too. Retain the
-- deployed operator authorization and the ready-item identity checks.
do $scheduled$
declare signature text; definition text;
  guard text:='if not coalesce((v_game.config->>''youtubeEnabled'')::boolean,false) then raise exception ''youtube not requested'' using errcode=''22023''; end if;';
begin
  foreach signature in array array[
    'public.claim_scheduled_youtube_broadcast(uuid,uuid)',
    'public.record_scheduled_youtube_broadcast(uuid,uuid,text,text,text,text,bigint)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(guard in definition)=0 then raise exception 'Expected scheduled YouTube intent guard in %',signature; end if;
    definition:=replace(definition,guard,guard || E'\n  if coalesce(v_game.config->>''youtubeVisibility'','''') not in (''unlisted'',''public'',''private'') then raise exception ''invalid scheduled youtube visibility'' using errcode=''22023''; end if;');
    execute definition;
  end loop;
end $scheduled$;

-- Return provider policy atomically with the scheduling claim. Reading it
-- before the claim would race a last pre-intent configuration edit.
alter function public.claim_scheduled_youtube_broadcast(uuid,uuid)
  rename to visibility_legacy_claim_scheduled_youtube_broadcast;
revoke all on function public.visibility_legacy_claim_scheduled_youtube_broadcast(uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.claim_scheduled_youtube_broadcast(p_user_id uuid,p_game_id uuid)
returns table(action text,status text,watch_url text,youtube_visibility text)
language plpgsql security definer set search_path='' as $$
declare receipt record; visibility text;
begin
  select * into receipt from public.visibility_legacy_claim_scheduled_youtube_broadcast(p_user_id,p_game_id);
  if not found then return; end if;
  select g.config->>'youtubeVisibility' into visibility from public.games g where g.id=p_game_id;
  return query select receipt.action,receipt.status,receipt.watch_url,visibility;
end $$;
revoke all on function public.claim_scheduled_youtube_broadcast(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.claim_scheduled_youtube_broadcast(uuid,uuid) to service_role;

-- The original assertion acquires the lifecycle/resource locks and performs
-- every delivery/channel/version/lease check. Its wrapper reads saved privacy
-- under those same locks; browser input cannot supply or override this fact.
alter function public.assert_m4_output_delivery(uuid,uuid,bigint,text,uuid)
  rename to visibility_legacy_assert_m4_output_delivery;
revoke all on function public.visibility_legacy_assert_m4_output_delivery(uuid,uuid,bigint,text,uuid)
  from public,anon,authenticated,service_role;

create function public.assert_m4_output_delivery(
  p_game_id uuid,p_session_id uuid,p_generation bigint,p_bearer_hash text,p_intent_id uuid)
returns table(intent_id uuid,session_id uuid,generation bigint,organization_id uuid,
  broadcast_generation bigint,youtube_broadcast_id text,youtube_stream_id text,youtube_channel_id text,
  youtube_connection_version bigint,encrypted_credentials text,expires_at timestamptz,
  lease_expires_at timestamptz,youtube_visibility text)
language plpgsql security definer set search_path='' as $$
declare receipt record; visibility text;
begin
  select * into receipt from public.visibility_legacy_assert_m4_output_delivery(
    p_game_id,p_session_id,p_generation,p_bearer_hash,p_intent_id);
  if not found then return; end if;
  select g.config->>'youtubeVisibility' into visibility from public.games g where g.id=p_game_id;
  if coalesce(visibility,'') not in ('unlisted','public','private') then
    raise exception 'invalid M4 youtube visibility' using errcode='55000';
  end if;
  return query select receipt.intent_id,receipt.session_id,receipt.generation,receipt.organization_id,
    receipt.broadcast_generation,receipt.youtube_broadcast_id,receipt.youtube_stream_id,
    receipt.youtube_channel_id,receipt.youtube_connection_version,receipt.encrypted_credentials,
    receipt.expires_at,receipt.lease_expires_at,visibility;
end $$;
revoke all on function public.assert_m4_output_delivery(uuid,uuid,bigint,text,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.assert_m4_output_delivery(uuid,uuid,bigint,text,uuid) to service_role;

-- A created or uncertain scheduled watch page keeps its privacy. Configuration
-- edits cannot silently reinterpret an existing provider broadcast on recovery.
do $edit$
declare definition text; anchor text:=E'  update public.games\n  set season_id = p_season_id,';
begin
  definition:=pg_get_functiondef('public.update_scheduled_team_game(uuid,uuid,uuid,uuid,uuid,timestamptz,text,integer,text,jsonb)'::regprocedure);
  -- Dashboard-pasted Windows function bodies may retain CRLF line endings.
  definition:=replace(definition,E'\r\n',E'\n');
  if position(anchor in definition)=0 then raise exception 'Expected locked scheduled game update'; end if;
  definition:=replace(definition,anchor,$guard$
  if coalesce((v_new_config->>'youtubeEnabled')::boolean,false)
    and coalesce(v_new_config->>'youtubeVisibility','') not in ('unlisted','public','private') then
    raise exception 'invalid scheduled youtube visibility' using errcode='22023';
  end if;
  if v_old_config->>'youtubeVisibility' is distinct from v_new_config->>'youtubeVisibility'
    and (exists(select 1 from public.broadcast_sessions where game_id=p_game_id and provider='youtube')
      or exists(select 1 from public.games where id=p_game_id and youtube_scheduled_status in ('intent','ready'))) then
    raise exception 'youtube_visibility_locked' using errcode='22023';
  end if;
$guard$ || anchor);
  execute definition;
end $edit$;

alter function public.get_scheduled_youtube_credentials(uuid,uuid)
  rename to visibility_legacy_get_scheduled_youtube_credentials;
revoke all on function public.visibility_legacy_get_scheduled_youtube_credentials(uuid,uuid)
  from public,anon,authenticated,service_role;
create function public.get_scheduled_youtube_credentials(p_user_id uuid,p_game_id uuid)
returns table(organization_id uuid,encrypted_credentials text,channel_id text,
  connection_version bigint,youtube_visibility text)
language plpgsql security definer set search_path='' as $$
declare visibility text;
begin
  perform public.verified_game_operator(p_user_id);
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_user_id,false);
  -- Match state-first lifecycle lock ordering before reading provider policy.
  perform 1 from public.game_states where game_id=p_game_id for share;
  select g.config->>'youtubeVisibility' into visibility from public.games g where g.id=p_game_id for share;
  if coalesce(visibility,'') not in ('unlisted','public','private') then
    raise exception 'invalid scheduled youtube visibility' using errcode='22023';
  end if;
  return query select r.organization_id,r.encrypted_credentials,r.channel_id,r.connection_version,visibility
    from public.visibility_legacy_get_scheduled_youtube_credentials(p_user_id,p_game_id) r;
end $$;
revoke all on function public.get_scheduled_youtube_credentials(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.get_scheduled_youtube_credentials(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
