-- Called only after server-side YouTube verification. Preserve evidence for End Game.
create function public.record_m4_live_evidence(p_game_id uuid, p_generation bigint, p_broadcast_id text, p_stream_id text)
returns void language plpgsql security definer set search_path='' as $$
begin
  update public.broadcast_sessions set started_at=coalesce(started_at,clock_timestamp())
  where game_id=p_game_id and provider='youtube' and transport='local-obs'
    and operation_generation=p_generation and youtube_broadcast_id=p_broadcast_id
    and youtube_stream_id=p_stream_id and status='prepared' and desired_state='live'
    and started_at is null;
end $$;
revoke all on function public.record_m4_live_evidence(uuid,bigint,text,text) from public,anon,authenticated;
grant execute on function public.record_m4_live_evidence(uuid,bigint,text,text) to service_role;
notify pgrst, 'reload schema';
