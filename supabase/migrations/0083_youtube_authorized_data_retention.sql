-- YouTube authorization retention: server-only daily verification, durable
-- withdrawal retries, and privacy redaction that preserves game evidence.
begin;

alter table public.broadcast_settings
  add column youtube_withdrawal_requested_at timestamptz,
  add column youtube_authorization_checked_at timestamptz,
  add column youtube_initial_verification_pending boolean not null default true,
  add column youtube_maintenance_claim_id uuid,
  add column youtube_maintenance_lease_expires_at timestamptz,
  add column youtube_maintenance_retry_at timestamptz,
  add column youtube_authorization_invalidated_at timestamptz,
  add column youtube_data_redacted_at timestamptz;
-- A connection test never verified the historical resource inventory. Queue
-- every existing grant immediately, using its age as a conservative cleanup
-- baseline until the first complete verification succeeds.
update public.broadcast_settings set youtube_authorization_checked_at=coalesce(connected_at,updated_at),
  youtube_withdrawal_requested_at=case when youtube_disconnect_pending then updated_at else null end
  where provider='youtube';

create function public.track_youtube_authorization_dates()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provider='youtube' then
    if tg_op='INSERT' then
      if new.connection_status='connected' and new.encrypted_credentials is not null then
        new.youtube_authorization_checked_at:=clock_timestamp();
        new.youtube_initial_verification_pending:=true;
      end if;
    else
      if new.youtube_disconnect_pending and not old.youtube_disconnect_pending then
        new.youtube_withdrawal_requested_at:=clock_timestamp();
      end if;
      if new.connection_status='connected' and new.encrypted_credentials is not null
        and (new.connection_version<>old.connection_version or new.encrypted_credentials is distinct from old.encrypted_credentials) then
        new.youtube_authorization_checked_at:=clock_timestamp();
        new.youtube_initial_verification_pending:=true;
        new.youtube_withdrawal_requested_at:=null;
        new.youtube_authorization_invalidated_at:=null;
        new.youtube_data_redacted_at:=null;
        new.youtube_maintenance_claim_id:=null;
        new.youtube_maintenance_lease_expires_at:=null;
        new.youtube_maintenance_retry_at:=null;
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger track_youtube_authorization_dates before insert or update on public.broadcast_settings
  for each row execute function public.track_youtube_authorization_dates();

alter table public.broadcast_sessions add column youtube_data_redacted_at timestamptz;
alter table public.m4_output_intents
  add column youtube_data_redacted_at timestamptz,
  alter column youtube_broadcast_id drop not null,
  alter column youtube_stream_id drop not null,
  add constraint m4_output_intents_resource_evidence check (
    youtube_data_redacted_at is not null or (youtube_broadcast_id is not null and youtube_stream_id is not null));
alter table public.m4_provider_retirements
  add column youtube_data_redacted_at timestamptz,
  alter column youtube_channel_id drop not null,
  drop constraint m4_provider_retirements_check,
  add constraint m4_provider_retirement_resource_evidence check (
    youtube_data_redacted_at is not null or (youtube_channel_id is not null and (youtube_broadcast_id is not null or youtube_stream_id is not null)));

-- The score/result evidence stays immutable. Only a provider-sourced replay
-- URL can be cleared; an independently entered shared URL is retained.
alter table public.game_completion_reviews add column youtube_watch_url_source text not null default 'user'
  check(youtube_watch_url_source in ('user','provider','none'));
alter table public.game_completions add column youtube_watch_url_source text not null default 'user'
  check(youtube_watch_url_source in ('user','provider','none'));

create function public.is_known_youtube_provider_link(p_game uuid,p_url text)
returns boolean language sql security definer set search_path='' stable as $$
  select exists(select 1 from public.broadcast_sessions s where s.game_id=p_game and s.provider='youtube' and s.watch_url=p_url)
    or exists(select 1 from public.games g where g.id=p_game and g.youtube_scheduled_watch_url=p_url)
    or exists(select 1 from public.m4_broadcast_cycle_history h where h.game_id=p_game and
      (h.metadata->>'watch_url'=p_url or 'https://www.youtube.com/watch?v='||(h.metadata->>'youtube_broadcast_id')=p_url))
    or exists(select 1 from public.m4_provider_retirements r where r.game_id=p_game and 'https://www.youtube.com/watch?v='||r.youtube_broadcast_id=p_url)
    or exists(select 1 from public.m4_output_intents i where i.game_id=p_game and 'https://www.youtube.com/watch?v='||i.youtube_broadcast_id=p_url)
    or exists(select 1 from public.audit_events a where a.action='game.youtube_scheduled' and a.subject_identifier=p_game::text
      and 'https://www.youtube.com/watch?v='||(a.metadata->>'broadcast_id')=p_url);
$$;
revoke all on function public.is_known_youtube_provider_link(uuid,text) from public,anon,authenticated,service_role;

alter table public.game_completion_reviews disable trigger prevent_completion_review_changes;
alter table public.game_completions disable trigger prevent_completion_changes;
update public.game_completion_reviews r set youtube_watch_url_source=case
  when r.youtube_watch_url is null then 'none'
  when public.is_known_youtube_provider_link(r.game_id,r.youtube_watch_url) then 'provider'
  else 'user' end;
update public.game_completions c set youtube_watch_url_source=case
  when c.youtube_watch_url is null then 'none'
  when public.is_known_youtube_provider_link(c.game_id,c.youtube_watch_url) then 'provider'
  else 'user' end;
alter table public.game_completion_reviews enable trigger prevent_completion_review_changes;
alter table public.game_completions enable trigger prevent_completion_changes;

create function public.classify_youtube_review_link()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.youtube_watch_url_source:=case when new.youtube_watch_url is null then 'none'
    when public.is_known_youtube_provider_link(new.game_id,new.youtube_watch_url) then 'provider'
    else 'user' end;
  return new;
end $$;
create trigger classify_youtube_review_link before insert on public.game_completion_reviews
  for each row execute function public.classify_youtube_review_link();
create or replace function public.copy_review_watch_url_to_completion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  select case when s.started_at is not null then coalesce(s.watch_url,r.youtube_watch_url) else r.youtube_watch_url end,
    case when s.started_at is not null and s.watch_url is not null then 'provider' else r.youtube_watch_url_source end
    into new.youtube_watch_url,new.youtube_watch_url_source
    from public.game_completion_reviews r left join public.broadcast_sessions s on s.game_id=r.game_id and s.provider='youtube'
    where r.id=new.review_id;
  return new;
end $$;

-- Restrict the immutability exception to removal of a provider link. It never
-- permits a score, completion identity, actor or independently supplied link edit.
do $immutable$
declare definition text; anchor text:=E'  -- Preserve immutable completion evidence';
begin
  definition:=replace(pg_get_functiondef('public.prevent_immutable_completion_changes()'::regprocedure),E'\r\n',E'\n');
  if position(anchor in definition)=0 then raise exception 'Missing completion immutability anchor'; end if;
  definition:=replace(definition,anchor,$redaction$
  if tg_op='UPDATE' and old.youtube_watch_url_source='provider' and old.youtube_watch_url is not null
    and new.youtube_watch_url is null and new.youtube_watch_url_source='none'
    and (v_old - 'youtube_watch_url' - 'youtube_watch_url_source') is not distinct from
      (v_new - 'youtube_watch_url' - 'youtube_watch_url_source') then return new; end if;
$redaction$ || anchor);
  execute definition;
end $immutable$;

-- Cleanup follows state -> game -> session -> connection ordering. Never take
-- the connection lock first and then wait for a writer holding game locks.
create function public.lock_youtube_privacy_cleanup(p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.game_states gs join public.games g on g.id=gs.game_id where g.organization_id=p_org order by gs.game_id for update of gs;
  perform 1 from public.games g where g.organization_id=p_org order by g.id for update;
  perform 1 from public.broadcast_sessions s where s.organization_id=p_org and s.provider='youtube' order by s.game_id for update;
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':youtube',20));
  perform 1 from public.broadcast_settings b where b.organization_id=p_org and b.provider='youtube' for update;
end $$;

-- Privacy removal after confirmed external revocation may affect a journal
-- still marked live. Removing authorization is NOT proof that its sender or
-- YouTube broadcast stopped. Keep its state and require YouTube Studio recovery.
create or replace function public.guard_youtube_connection_in_use()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.youtube_authorization_invalidated_at is not null and new.youtube_data_redacted_at is not null
    and new.encrypted_credentials is null and new.channel_id is null and new.connection_status='disconnected' then return new; end if;
  if exists(select 1 from public.broadcast_sessions s where s.organization_id=old.organization_id and s.provider='youtube' and s.status not in ('idle','stopped'))
    and (new.channel_id is distinct from old.channel_id or (old.encrypted_credentials is not null and new.encrypted_credentials is null)) then
    raise exception 'youtube connection has an unfinished broadcast' using errcode='55000';
  end if;
  return new;
end $$;
create or replace function public.assert_youtube_not_disconnecting(p_organization_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare b public.broadcast_settings;
begin
  select * into b from public.broadcast_settings where organization_id=p_organization_id and provider='youtube' for update;
  if found and (b.youtube_disconnect_pending or b.youtube_authorization_invalidated_at is not null or b.youtube_data_redacted_at is not null) then
    raise exception 'youtube disconnect pending' using errcode='55000';
  end if;
end $$;
create or replace function public.guard_youtube_disconnect_session()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and new.youtube_data_redacted_at is not null
    and new.youtube_broadcast_id is null and new.youtube_stream_id is null and new.youtube_channel_id is null
    and new.provider_session_id is null and new.watch_url is null
    and (to_jsonb(old)-array['youtube_broadcast_id','youtube_stream_id','youtube_channel_id','provider_session_id','watch_url','youtube_data_redacted_at'])
      is not distinct from (to_jsonb(new)-array['youtube_broadcast_id','youtube_stream_id','youtube_channel_id','provider_session_id','watch_url','youtube_data_redacted_at']) then return new; end if;
  if new.provider='youtube' and (new.status not in ('idle','stopped') or new.desired_state='live') then
    perform public.assert_youtube_not_disconnecting(new.organization_id);
  end if;
  return new;
end $$;


-- Only provider API metadata may be redacted; audit identity/action/internal evidence remains append-only.
create or replace function public.prevent_audit_event_changes()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and old.actor_user_id is not null and new.actor_user_id is null
    and (to_jsonb(old)-'actor_user_id') is not distinct from (to_jsonb(new)-'actor_user_id') then return new; end if;
  if tg_op='UPDATE' and old.action in ('youtube.connected','game.youtube_scheduled')
    and (to_jsonb(old)-'metadata') is not distinct from (to_jsonb(new)-'metadata')
    and (new.metadata=old.metadata-array['channel_id','broadcast_id'] or new.metadata=old.metadata-'channel_id' or new.metadata=old.metadata-'broadcast_id') then return new; end if;
  raise exception 'audit events are append-only' using errcode='55000';
end $$;


-- Reconnection may start after completed redaction. Pending withdrawal remains fenced.
create function public.assert_youtube_oauth_not_pending(p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.broadcast_settings where organization_id=p_org and provider='youtube' for update;
  if exists(select 1 from public.broadcast_settings where organization_id=p_org and provider='youtube' and youtube_disconnect_pending) then
    raise exception 'youtube disconnect pending' using errcode='55000'; end if;
end $$;
revoke all on function public.assert_youtube_oauth_not_pending(uuid) from public,anon,authenticated,service_role;
do $oauth$ declare definition text; begin
  definition:=pg_get_functiondef('public.begin_youtube_oauth(uuid,text,timestamptz)'::regprocedure);
  if position('perform public.assert_youtube_not_disconnecting(v_org);' in definition)=0 then raise exception 'Missing OAuth fence'; end if;
  definition:=replace(definition,'perform public.assert_youtube_not_disconnecting(v_org);','perform public.assert_youtube_oauth_not_pending(v_org);'); execute definition;
end $oauth$;

create function public.purge_youtube_authorized_data(p_org uuid,p_version bigint,p_reason text)
returns bigint language plpgsql security definer set search_path='' as $$
declare b public.broadcast_settings; stamp timestamptz:=clock_timestamp();
begin
  if p_reason not in ('in_app','external','unconfirmed','unverified','legacy') then raise exception 'invalid privacy removal' using errcode='22023'; end if;
  perform public.lock_youtube_privacy_cleanup(p_org);
  select * into b from public.broadcast_settings where organization_id=p_org and provider='youtube' for update;
  if not found or b.connection_version is distinct from p_version then raise exception 'youtube connection changed' using errcode='PT409'; end if;
  if p_reason='legacy' and (b.encrypted_credentials is not null or b.connection_status<>'disconnected') then raise exception 'legacy authorization still present' using errcode='55000'; end if;
  if p_reason='in_app' and not b.youtube_disconnect_pending then raise exception 'youtube disconnect receipt required' using errcode='55000'; end if;
  if p_reason='unconfirmed' and (not b.youtube_disconnect_pending or b.youtube_withdrawal_requested_at is null or b.youtube_withdrawal_requested_at>stamp-interval '5 days') then
    raise exception 'youtube withdrawal deadline not due' using errcode='55000'; end if;

  if p_reason='unverified' and (b.youtube_disconnect_pending or coalesce(b.youtube_authorization_checked_at,b.connected_at,b.updated_at)>stamp-interval '28 days') then raise exception 'youtube verification deadline not due' using errcode='55000'; end if;

  update public.game_completion_reviews r set youtube_watch_url=null,youtube_watch_url_source='none'
    from public.games g where r.game_id=g.id and g.organization_id=p_org and r.youtube_watch_url_source='provider';
  update public.game_completions c set youtube_watch_url=null,youtube_watch_url_source='none'
    where c.organization_id=p_org and c.youtube_watch_url_source='provider';
  update public.games set youtube_scheduled_broadcast_id=null,youtube_scheduled_watch_url=null,
    youtube_scheduled_channel_id=null,youtube_scheduled_connection_version=null,
    youtube_scheduled_status='none',youtube_scheduled_error_code=null,youtube_scheduled_updated_at=stamp
    where organization_id=p_org and (youtube_scheduled_broadcast_id is not null or youtube_scheduled_watch_url is not null or youtube_scheduled_channel_id is not null or youtube_scheduled_status in ('intent','ready'));
  update public.broadcast_sessions set youtube_broadcast_id=null,youtube_stream_id=null,youtube_channel_id=null,
    provider_session_id=null,watch_url=null,youtube_data_redacted_at=stamp
    where organization_id=p_org and provider='youtube';
  update public.m4_output_intents set youtube_broadcast_id=null,youtube_stream_id=null,delivery_channel_id=null,youtube_data_redacted_at=stamp
    where organization_id=p_org;
  update public.m4_provider_retirements set youtube_broadcast_id=null,youtube_stream_id=null,youtube_channel_id=null,youtube_data_redacted_at=stamp
    where organization_id=p_org;
  update public.m4_broadcast_cycle_history set metadata=metadata-array['youtube_broadcast_id','youtube_stream_id','youtube_channel_id','provider_session_id','watch_url']
    where organization_id=p_org;
  update public.audit_events set metadata=metadata-array['channel_id','broadcast_id']
    where organization_id=p_org and action in ('youtube.connected','game.youtube_scheduled');
  delete from public.youtube_oauth_states where organization_id=p_org;
  update public.broadcast_settings set encrypted_credentials=null,channel_id=null,channel_title=null,
    connection_status='disconnected',connection_version=connection_version+1,youtube_disconnect_pending=false,
    connected_by=null,connected_at=null,tested_at=null,youtube_data_redacted_at=stamp,
    youtube_authorization_invalidated_at=case when p_reason in ('external','unverified','legacy') then stamp else youtube_authorization_invalidated_at end,
    youtube_maintenance_claim_id=null,youtube_maintenance_lease_expires_at=null,youtube_maintenance_retry_at=null,
    last_error_code=case when p_reason='unconfirmed' then 'revocation_unconfirmed_data_removed'
      when p_reason='unverified' then 'authorization_unverified_data_removed'
      when p_reason='external' then 'authorization_revoked_use_youtube_studio' else null end,updated_at=stamp
    where id=b.id;
  insert into public.audit_events(organization_id,action,subject_type,subject_identifier,metadata)
    values(p_org,'youtube.authorized_data_removed','organization',p_org::text,
      jsonb_build_object('reason',p_reason,'connection_version',p_version+1));
  return p_version+1;
end $$;

create or replace function public.finish_youtube_disconnect(p_user_id uuid,p_expected_organization_id uuid,p_expected_version bigint,p_disconnect_operation_id uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.youtube_team(p_user_id,true); b public.broadcast_settings;
begin
  if v_org is distinct from p_expected_organization_id then raise exception 'youtube organization changed' using errcode='PT409'; end if;
  perform public.lock_youtube_privacy_cleanup(v_org);
  select * into b from public.broadcast_settings where organization_id=v_org and provider='youtube' for update;
  if not found or p_disconnect_operation_id is null or b.youtube_disconnect_operation_id is distinct from p_disconnect_operation_id then raise exception 'youtube connection changed' using errcode='PT409'; end if;
  if not b.youtube_disconnect_pending and b.encrypted_credentials is null and b.connection_status='disconnected' and b.connection_version=p_expected_version+1 then return b.connection_version; end if;
  if not b.youtube_disconnect_pending or b.connection_version is distinct from p_expected_version then raise exception 'youtube connection changed' using errcode='PT409'; end if;
  if exists(select 1 from public.broadcast_sessions s where s.organization_id=v_org and s.provider='youtube' and (s.status not in ('idle','stopped') or s.desired_state='live')) then raise exception 'youtube connection has an unfinished broadcast' using errcode='55000'; end if;
  return public.purge_youtube_authorized_data(v_org,p_expected_version,'in_app');
end $$;

create function public.claim_youtube_authorization_maintenance(p_limit integer default 100)
returns table(organization_id uuid,connection_version bigint,encrypted_credentials text,channel_id text,
  disconnect_pending boolean,withdrawal_requested_at timestamptz,maintenance_claim_id uuid)
language plpgsql security definer set search_path='' as $$
declare b public.broadcast_settings;
begin
  if p_limit not between 1 and 100 then raise exception 'invalid maintenance batch' using errcode='22023'; end if;
  for b in select * from public.broadcast_settings s where s.provider='youtube' and s.encrypted_credentials is not null
    and (s.youtube_disconnect_pending or s.youtube_initial_verification_pending or s.youtube_authorization_checked_at is null or s.youtube_authorization_checked_at<=clock_timestamp()-interval '24 days')
    and (s.youtube_maintenance_lease_expires_at is null or s.youtube_maintenance_lease_expires_at<=clock_timestamp())
    and (s.youtube_maintenance_retry_at is null or s.youtube_maintenance_retry_at<=clock_timestamp())
    order by s.youtube_disconnect_pending desc,s.youtube_withdrawal_requested_at nulls last,s.youtube_authorization_checked_at nulls first
    limit p_limit for update skip locked loop
    update public.broadcast_settings set youtube_maintenance_claim_id=gen_random_uuid(),youtube_maintenance_lease_expires_at=clock_timestamp()+interval '10 minutes' where id=b.id returning * into b;
    return query select b.organization_id,b.connection_version,encode(b.encrypted_credentials,'base64'),b.channel_id,
      b.youtube_disconnect_pending,b.youtube_withdrawal_requested_at,b.youtube_maintenance_claim_id;
  end loop;
end $$;

create function public.finish_youtube_authorization_maintenance(
  p_org uuid,p_expected_version bigint,p_claim_id uuid,p_result text,p_channel_title text default null)
returns text language plpgsql security definer set search_path='' as $$
declare b public.broadcast_settings;
begin
  if p_result not in ('valid','revoked','revocation_confirmed','unavailable') then raise exception 'invalid maintenance result' using errcode='22023'; end if;
  if p_result in ('revoked','revocation_confirmed','unavailable') then perform public.lock_youtube_privacy_cleanup(p_org); end if;
  select * into b from public.broadcast_settings where organization_id=p_org and provider='youtube' for update;
  if not found or b.connection_version is distinct from p_expected_version or b.youtube_maintenance_claim_id is distinct from p_claim_id or p_claim_id is null then return 'stale'; end if;
  if p_result='revoked' then
    perform public.purge_youtube_authorized_data(p_org,p_expected_version,'external'); return 'removed';
  elsif p_result='revocation_confirmed' and b.youtube_disconnect_pending then
    perform public.purge_youtube_authorized_data(p_org,p_expected_version,'in_app'); return 'removed';
  elsif p_result='unavailable' and b.youtube_disconnect_pending and b.youtube_withdrawal_requested_at<=clock_timestamp()-interval '5 days' then
    perform public.purge_youtube_authorized_data(p_org,p_expected_version,'unconfirmed'); return 'removed_unconfirmed';
  elsif p_result='unavailable' and not b.youtube_disconnect_pending and coalesce(b.youtube_authorization_checked_at,b.connected_at,b.updated_at)<=clock_timestamp()-interval '28 days' then
    perform public.purge_youtube_authorized_data(p_org,p_expected_version,'unverified'); return 'removed_unconfirmed';
  elsif p_result='valid' and not b.youtube_disconnect_pending and p_channel_title is not null and length(p_channel_title) between 1 and 200 then
    update public.audit_events set metadata=metadata-'channel_id' where organization_id=p_org and action='youtube.connected' and metadata->>'channel_id' is distinct from b.channel_id;
    update public.broadcast_settings set youtube_authorization_checked_at=clock_timestamp(),youtube_initial_verification_pending=false,channel_title=p_channel_title,
      youtube_maintenance_claim_id=null,youtube_maintenance_lease_expires_at=null,youtube_maintenance_retry_at=null where id=b.id;
    return 'verified';
  end if;
  update public.broadcast_settings set youtube_maintenance_claim_id=null,youtube_maintenance_lease_expires_at=null,
    youtube_maintenance_retry_at=clock_timestamp()+interval '1 hour' where id=b.id;
  return 'retry';
end $$;

revoke all on function public.track_youtube_authorization_dates(),public.classify_youtube_review_link(),
  public.lock_youtube_privacy_cleanup(uuid),public.purge_youtube_authorized_data(uuid,bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function public.claim_youtube_authorization_maintenance(integer),
  public.finish_youtube_authorization_maintenance(uuid,bigint,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.claim_youtube_authorization_maintenance(integer),
  public.finish_youtube_authorization_maintenance(uuid,bigint,uuid,text,text) to service_role;

-- Inventory every retained provider resource, including archived cycles. A
-- caller never receives credentials or user-entered watch links from this RPC.
create function public.get_youtube_maintenance_resources(p_org uuid,p_expected_version bigint,p_claim_id uuid)
returns table(kind text,id text) language plpgsql security definer set search_path='' as $$
declare resource_count bigint;
begin
  if not exists(select 1 from public.broadcast_settings b where b.organization_id=p_org and b.provider='youtube'
    and b.connection_version=p_expected_version and b.youtube_maintenance_claim_id=p_claim_id) then raise exception 'youtube maintenance changed' using errcode='PT409'; end if;
  return query
    with resources as (
      select 'broadcast'::text k,s.youtube_broadcast_id i from public.broadcast_sessions s where s.organization_id=p_org and s.provider='youtube'
      union select 'stream',s.youtube_stream_id from public.broadcast_sessions s where s.organization_id=p_org and s.provider='youtube'
      union select 'broadcast',g.youtube_scheduled_broadcast_id from public.games g where g.organization_id=p_org
      union select 'broadcast',i.youtube_broadcast_id from public.m4_output_intents i where i.organization_id=p_org
      union select 'stream',i.youtube_stream_id from public.m4_output_intents i where i.organization_id=p_org
      union select 'broadcast',r.youtube_broadcast_id from public.m4_provider_retirements r where r.organization_id=p_org
      union select 'stream',r.youtube_stream_id from public.m4_provider_retirements r where r.organization_id=p_org
      union select 'broadcast',h.metadata->>'youtube_broadcast_id' from public.m4_broadcast_cycle_history h where h.organization_id=p_org
      union select 'stream',h.metadata->>'youtube_stream_id' from public.m4_broadcast_cycle_history h where h.organization_id=p_org
      union select 'broadcast',substring(c.youtube_watch_url from '[?&]v=([^&#]+)') from public.game_completions c where c.organization_id=p_org and c.youtube_watch_url_source='provider'
      union select 'broadcast',substring(r.youtube_watch_url from '[?&]v=([^&#]+)') from public.game_completion_reviews r join public.games g on g.id=r.game_id where g.organization_id=p_org and r.youtube_watch_url_source='provider'
      union select 'broadcast',a.metadata->>'broadcast_id' from public.audit_events a where a.organization_id=p_org and a.action='game.youtube_scheduled'
    ) select resources.k,resources.i from resources where resources.i is not null and resources.i<>'';
  get diagnostics resource_count=row_count;
  if resource_count>1000 then raise exception 'youtube retention inventory requires operator review' using errcode='55000'; end if;
end $$;

create function public.redact_missing_youtube_resources(p_org uuid,p_broadcasts text[],p_streams text[])
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.game_completion_reviews r set youtube_watch_url=null,youtube_watch_url_source='none'
    from public.games g where r.game_id=g.id and g.organization_id=p_org and r.youtube_watch_url_source='provider'
      and substring(r.youtube_watch_url from '[?&]v=([^&#]+)')=any(p_broadcasts);
  update public.game_completions c set youtube_watch_url=null,youtube_watch_url_source='none'
    where c.organization_id=p_org and c.youtube_watch_url_source='provider'
      and substring(c.youtube_watch_url from '[?&]v=([^&#]+)')=any(p_broadcasts);
  update public.games set youtube_scheduled_broadcast_id=null,youtube_scheduled_watch_url=null,youtube_scheduled_channel_id=null,
    youtube_scheduled_connection_version=null,youtube_scheduled_status='none',youtube_scheduled_error_code=null,youtube_scheduled_updated_at=clock_timestamp()
    where organization_id=p_org and youtube_scheduled_broadcast_id=any(p_broadcasts);
  update public.broadcast_sessions set youtube_broadcast_id=null,youtube_stream_id=null,youtube_channel_id=null,
    provider_session_id=null,watch_url=null,youtube_data_redacted_at=clock_timestamp()
    where organization_id=p_org and provider='youtube' and (youtube_broadcast_id=any(p_broadcasts) or youtube_stream_id=any(p_streams));
  update public.m4_output_intents set youtube_broadcast_id=null,youtube_stream_id=null,delivery_channel_id=null,youtube_data_redacted_at=clock_timestamp()
    where organization_id=p_org and (youtube_broadcast_id=any(p_broadcasts) or youtube_stream_id=any(p_streams));
  update public.m4_provider_retirements set youtube_broadcast_id=null,youtube_stream_id=null,youtube_channel_id=null,youtube_data_redacted_at=clock_timestamp()
    where organization_id=p_org and (youtube_broadcast_id=any(p_broadcasts) or youtube_stream_id=any(p_streams));
  update public.m4_broadcast_cycle_history set metadata=metadata-array['youtube_broadcast_id','youtube_stream_id','youtube_channel_id','provider_session_id','watch_url']
    where organization_id=p_org and (metadata->>'youtube_broadcast_id'=any(p_broadcasts) or metadata->>'youtube_stream_id'=any(p_streams));
  update public.audit_events set metadata=metadata-'broadcast_id' where organization_id=p_org and action='game.youtube_scheduled' and metadata->>'broadcast_id'=any(p_broadcasts);
end $$;

create function public.record_youtube_resource_verification(p_org uuid,p_expected_version bigint,p_claim_id uuid,p_missing_broadcasts text[],p_missing_streams text[])
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if coalesce(cardinality(p_missing_broadcasts),0)>1000 or coalesce(cardinality(p_missing_streams),0)>1000 then raise exception 'invalid verification batch' using errcode='22023'; end if;
  perform public.lock_youtube_privacy_cleanup(p_org);
  if not exists(select 1 from public.broadcast_settings b where b.organization_id=p_org and b.provider='youtube'
    and b.connection_version=p_expected_version and b.youtube_maintenance_claim_id=p_claim_id and not b.youtube_disconnect_pending) then return false; end if;
  perform public.redact_missing_youtube_resources(p_org,coalesce(p_missing_broadcasts,array[]::text[]),coalesce(p_missing_streams,array[]::text[]));
  return true;
end $$;
revoke all on function public.get_youtube_maintenance_resources(uuid,bigint,uuid),
  public.redact_missing_youtube_resources(uuid,text[],text[]),
  public.record_youtube_resource_verification(uuid,bigint,uuid,text[],text[]) from public,anon,authenticated,service_role;
grant execute on function public.get_youtube_maintenance_resources(uuid,bigint,uuid),
  public.record_youtube_resource_verification(uuid,bigint,uuid,text[],text[]) to service_role;

-- Old disconnects already destroyed credentials before this workflow existed.
-- Remove their retained API copies during migration rather than skipping them forever.
do $legacy$ declare connection record; begin
  for connection in select organization_id,connection_version from public.broadcast_settings
    where provider='youtube' and connection_status='disconnected' and encrypted_credentials is null loop
    perform public.purge_youtube_authorized_data(connection.organization_id,connection.connection_version,'legacy');
  end loop;
end $legacy$;

notify pgrst,'reload schema';
commit;
