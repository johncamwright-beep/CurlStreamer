begin;

-- YouTube's lifecycle start is a closer estimate of video zero than the time
-- at which a Studio poll discovered that the broadcast was already live.
alter table public.broadcast_sessions add column youtube_actual_started_at timestamptz;

create function public.clear_replaced_youtube_recording_start()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.youtube_actual_started_at := null;
  return new;
end;
$$;

-- M4 replacement archives the whole prior row before changing its binding.
-- Same-video recovery keeps the anchor across output generations.
create trigger clear_replaced_youtube_recording_start
before update of session_key, youtube_broadcast_id on public.broadcast_sessions
for each row when (
  old.session_key is distinct from new.session_key
  or old.youtube_broadcast_id is distinct from new.youtube_broadcast_id
)
execute function public.clear_replaced_youtube_recording_start();

revoke all on function public.clear_replaced_youtube_recording_start()
  from public, anon, authenticated, service_role;

create function public.record_m4_live_evidence(
  p_game_id uuid, p_generation bigint, p_broadcast_id text, p_stream_id text,
  p_youtube_actual_started_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare observed_at timestamptz := clock_timestamp();
begin
  if not isfinite(p_youtube_actual_started_at) or p_youtube_actual_started_at > observed_at then
    p_youtube_actual_started_at := null;
  end if;
  update public.broadcast_sessions b
  set started_at = coalesce(b.started_at, observed_at),
    youtube_actual_started_at = coalesce(b.youtube_actual_started_at,
      case when p_youtube_actual_started_at <= coalesce(b.started_at, observed_at)
        then p_youtube_actual_started_at end)
  where b.game_id = p_game_id and b.provider = 'youtube' and b.transport = 'local-obs'
    and b.operation_generation = p_generation and b.youtube_broadcast_id = p_broadcast_id
    and b.youtube_stream_id = p_stream_id and b.status = 'prepared' and b.desired_state = 'live'
    and (b.started_at is null or (
      b.youtube_actual_started_at is null and p_youtube_actual_started_at <= b.started_at
    ));
end;
$$;

revoke all on function public.record_m4_live_evidence(uuid, bigint, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_m4_live_evidence(uuid, bigint, text, text, timestamptz)
  to service_role;

create or replace function public.record_m4_live_evidence(
  p_game_id uuid, p_generation bigint, p_broadcast_id text, p_stream_id text
)
returns void language sql security definer set search_path = '' as $$
  select public.record_m4_live_evidence(p_game_id, p_generation, p_broadcast_id, p_stream_id, null);
$$;

create or replace function public.read_shot_tracker_recording_history(
  p_actor uuid, p_org uuid, p_games uuid[]
)
returns table (
  game_id uuid, youtube_broadcast_id text, started_at timestamptz,
  stopped_at timestamptz, is_current boolean
)
language plpgsql security definer set search_path = '' as $$
declare requested_game uuid;
begin
  if p_games is null or cardinality(p_games) = 0 then return; end if;
  foreach requested_game in array p_games loop
    perform public.assert_curlcoach_actor(p_actor, p_org, requested_game);
  end loop;

  return query
    with selected_games as (
      select g.id from public.games g
      where g.organization_id = p_org and g.id = any(p_games) and g.deleted_at is null
    )
    select b.game_id, b.youtube_broadcast_id, coalesce(b.youtube_actual_started_at, b.started_at), b.stopped_at, true
    from public.broadcast_sessions b join selected_games g on g.id = b.game_id
    where b.organization_id = p_org and b.provider = 'youtube'
      and b.youtube_broadcast_id is not null
    union all
    select h.game_id, r.youtube_broadcast_id,
      coalesce((h.metadata->>'youtube_actual_started_at')::timestamptz, (h.metadata->>'started_at')::timestamptz),
      coalesce((h.metadata->>'stopped_at')::timestamptz, r.confirmed_at), false
    from public.m4_broadcast_cycle_history h
    join selected_games g on g.id = h.game_id
    join public.m4_provider_retirements r on r.retirement_id = h.retirement_id
      and r.game_id = h.game_id and r.organization_id = h.organization_id
      and r.youtube_broadcast_id = h.metadata->>'youtube_broadcast_id'
    where h.organization_id = p_org and h.metadata->>'provider' = 'youtube';
end;
$$;

notify pgrst, 'reload schema';
commit;
