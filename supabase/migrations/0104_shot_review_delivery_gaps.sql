begin;

-- Preserve the original RPC for clients deployed before delivery gaps were
-- available. Its authorized recording history also scopes every lookup here.
create function public.read_shot_tracker_recording_history_v2(
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
    select jsonb_agg(jsonb_build_object('stopped_at', delivery.stop_at,
      'resumed_at', delivery.resume_at) order by delivery.stop_at) as value
    from (
      select i.delivery_recorded_at,
        lead(i.delivery_recorded_at) over (order by i.delivery_recorded_at, i.intent_id) as resume_at,
        case
          when not coalesce(isfinite(s.expires_at) and isfinite(s.lease_expires_at), false)
            then null
          -- A timely Stop receipt follows native output shutdown. A later
          -- revocation can instead reflect replacement of an expired desktop.
          when s.status = 'stopped' and s.revoked_at <= least(s.expires_at, s.lease_expires_at)
            then s.revoked_at
          -- The last issued authority bounds an interrupted sender, including
          -- the same allowance used to authorize a safe M4 replacement sender.
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
    ) delivery
    where isfinite(recording.started_at)
      and isfinite(delivery.stop_at)
      and delivery.stop_at >= greatest(recording.started_at, delivery.delivery_recorded_at)
      and delivery.stop_at < delivery.resume_at
  ) gaps;
$$;

revoke all on function public.read_shot_tracker_recording_history_v2(uuid, uuid, uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.read_shot_tracker_recording_history_v2(uuid, uuid, uuid[])
  to service_role;

notify pgrst, 'reload schema';
commit;
