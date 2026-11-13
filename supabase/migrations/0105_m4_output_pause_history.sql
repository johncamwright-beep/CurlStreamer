begin;

create table public.m4_output_pauses (
  intent_id uuid not null references public.m4_output_intents(intent_id),
  pause_id uuid not null,
  stopped_at timestamptz not null check (isfinite(stopped_at)),
  resumed_at timestamptz check (isfinite(resumed_at) and resumed_at > stopped_at),
  primary key (intent_id, pause_id)
);
create unique index m4_output_pauses_one_open on public.m4_output_pauses(intent_id)
  where resumed_at is null;
alter table public.m4_output_pauses enable row level security;
revoke all on public.m4_output_pauses from public, anon, authenticated, service_role;

create function public.record_m4_output_pause(
  p_game_id uuid, p_session_id uuid, p_generation bigint, p_bearer_hash text,
  p_intent_id uuid, p_pause_id uuid, p_stopped_at timestamptz, p_resumed_at timestamptz
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_delivery timestamptz;
  v_stopped_at timestamptz;
  v_latest timestamptz;
  v_previous public.m4_output_pauses;
begin
  if p_pause_id is null or not coalesce(isfinite(p_stopped_at), false)
    or (p_resumed_at is not null and not isfinite(p_resumed_at)) then
    raise exception 'invalid output pause' using errcode = '22023';
  end if;

  -- This assertion holds the existing game, desktop and output intent locks.
  -- Conflicting pause writes for the same delivered intent serialize there.
  perform 1 from public.assert_m4_output_delivery(
    p_game_id, p_session_id, p_generation, p_bearer_hash, p_intent_id);
  if not found then raise exception 'output authority denied' using errcode = '42501'; end if;

  select i.delivery_recorded_at into v_delivery from public.m4_output_intents i
  where i.intent_id = p_intent_id;
  v_latest := clock_timestamp() + interval '5 seconds';
  v_stopped_at := greatest(p_stopped_at, v_delivery);
  if not coalesce(isfinite(v_delivery), false)
    or p_stopped_at < v_delivery - interval '5 seconds' or v_stopped_at > v_latest
    or (p_resumed_at is not null and (p_resumed_at <= v_stopped_at or p_resumed_at > v_latest)) then
    raise exception 'invalid output pause timing' using errcode = '22023';
  end if;

  select * into v_previous from public.m4_output_pauses p
  where p.intent_id = p_intent_id and p.pause_id = p_pause_id;
  if found then
    if v_previous.stopped_at is distinct from v_stopped_at
      or (v_previous.resumed_at is not null and p_resumed_at is not null
        and v_previous.resumed_at is distinct from p_resumed_at) then
      raise exception 'output pause already recorded' using errcode = '55000';
    end if;
    if v_previous.resumed_at is null and p_resumed_at is not null then
      update public.m4_output_pauses p set resumed_at = p_resumed_at
      where p.intent_id = p_intent_id and p.pause_id = p_pause_id;
    end if;
    return;
  end if;

  if exists (
    select 1 from public.m4_output_pauses p where p.intent_id = p_intent_id
      and tstzrange(p.stopped_at, p.resumed_at, '[)') && tstzrange(v_stopped_at, p_resumed_at, '[)')
  ) then
    raise exception 'overlapping output pause' using errcode = '55000';
  end if;

  insert into public.m4_output_pauses(intent_id, pause_id, stopped_at, resumed_at)
  values (p_intent_id, p_pause_id, v_stopped_at, p_resumed_at);
end;
$$;

revoke all on function public.record_m4_output_pause(uuid, uuid, bigint, text, uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_m4_output_pause(uuid, uuid, bigint, text, uuid, uuid, timestamptz, timestamptz)
  to service_role;

create or replace function public.read_shot_tracker_recording_history_v2(
  p_actor uuid, p_org uuid, p_games uuid[]
)
returns table (
  game_id uuid, youtube_broadcast_id text, started_at timestamptz,
  stopped_at timestamptz, is_current boolean, delivery_gaps jsonb
)
language sql security definer set search_path = '' as $$
  select recording.game_id, recording.youtube_broadcast_id, recording.started_at,
    recording.stopped_at, recording.is_current, coalesce(gaps.value, '[]'::jsonb)
  from public.read_shot_tracker_recording_history(p_actor, p_org, p_games) recording
  cross join lateral (
    with deliveries as (
      select i.intent_id, i.delivery_recorded_at,
        lead(i.delivery_recorded_at) over (order by i.delivery_recorded_at, i.intent_id) as next_delivery_at,
        case
          when not coalesce(isfinite(s.expires_at) and isfinite(s.lease_expires_at), false)
            then null
          when s.status = 'stopped' and s.revoked_at <= least(s.expires_at, s.lease_expires_at)
            then s.revoked_at
          else least(s.expires_at, s.lease_expires_at) + interval '3 seconds'
        end as stop_at
      from public.m4_output_intents i
      join public.m4_desktop_sessions s on s.session_id = i.session_id
        and s.game_id = i.game_id and s.organization_id = i.organization_id
        and s.generation = i.generation
      where i.game_id = recording.game_id and i.organization_id = p_org
        and i.youtube_broadcast_id = recording.youtube_broadcast_id
        and isfinite(i.delivery_recorded_at)
        and i.delivery_recorded_at <= coalesce(recording.stopped_at, statement_timestamp())
    ), intervals as (
      select d.delivery_recorded_at, d.stop_at, d.next_delivery_at as resume_at
      from deliveries d
      where d.next_delivery_at is not null
      union all
      -- If Studio stopped while paused, the next same-video delivery closes
      -- the open pause. Otherwise it remains an open pause. Both sources may
      -- describe part of the same interval.
      select d.delivery_recorded_at, p.stopped_at, least(p.resumed_at, d.next_delivery_at)
      from deliveries d join public.m4_output_pauses p using (intent_id)
    )
    select jsonb_agg(jsonb_build_object('stopped_at', i.stop_at,
      'resumed_at', i.resume_at) order by i.stop_at, i.resume_at) as value
    from intervals i
    where isfinite(recording.started_at)
      and isfinite(i.stop_at)
      and i.stop_at >= greatest(recording.started_at, i.delivery_recorded_at)
      and i.stop_at <= coalesce(recording.stopped_at, statement_timestamp())
      and (i.resume_at is null or (
        i.stop_at < i.resume_at
        and i.resume_at <= coalesce(recording.stopped_at, statement_timestamp())
      ))
  ) gaps;
$$;

notify pgrst, 'reload schema';
commit;
