-- Game numbers are optional. Keep the existing authority, locks and grants.
begin;
do $migration$
declare fn record; definition text; changed integer := 0;
begin
  for fn in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_scheduled_team_game','update_scheduled_team_game')
  loop
    definition := pg_get_functiondef(fn.oid);
    if definition like '%p_game_number is null or %' and definition like '%p_timezone%' then
      definition := replace(definition, 'p_game_number is null or ', '');
      definition := replace(definition, 'v_event_name || '' — Game '' || p_game_number', 'v_event_name || coalesce('' · Game '' || p_game_number, '''')');
      execute definition;
      changed := changed + 1;
    end if;
  end loop;
  if changed <> 2 then raise exception 'Expected two schedule guards, found %', changed; end if;
end $migration$;
create or replace function public.read_game_completion_summary(p_game_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'status', 'completed',
    'eventName', regexp_replace(c.result_context->>'eventName', ' [—·-] Game [0-9]+$', '') || case when g.game_number is null then '' else ' · Game ' || g.game_number end,
    'homeName', c.result_context->>'homeName',
    'awayName', c.result_context->>'awayName',
    'result', c.result,
    'youtubeWatchUrl', c.youtube_watch_url,
    'completedAt', c.completed_at)
  from public.game_completions c join public.games g on g.id=c.game_id
  where c.game_id=p_game_id and g.deleted_at is null;
$$;
notify pgrst, 'reload schema';
commit;
