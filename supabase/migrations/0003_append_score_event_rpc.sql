-- Persist the append-only scoring history and its derived state in one
-- transaction. The version predicate rejects stale scorer updates rather than
-- allowing either representation to overwrite a concurrent change.
create or replace function public.append_score_event(
  p_game_id uuid,
  p_expected_version bigint,
  p_event_id uuid,
  p_event_type text,
  p_payload jsonb,
  p_actor text,
  p_state jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.game_states
  set state = p_state,
      version = greatest(
        version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where game_id = p_game_id
    and version = p_expected_version;

  if not found then
    raise exception 'stale game state for %', p_game_id
      using errcode = '40001';
  end if;

  insert into public.score_events (
    id,
    game_id,
    event_type,
    payload,
    actor
  ) values (
    p_event_id,
    p_game_id,
    p_event_type,
    p_payload,
    p_actor
  );
end;
$$;

revoke all on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb) from public;
revoke all on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb) from anon;
revoke all on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb) from authenticated;
grant execute on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb) to service_role;

notify pgrst, 'reload schema';
