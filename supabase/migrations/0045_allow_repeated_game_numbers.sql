begin;
-- Game UUIDs identify matches. The optional event number is a display label,
-- so deleted games and deliberate duplicates must not reserve it.
drop index if exists public.games_event_game_number_unique;
create index if not exists games_event_game_number_lookup
  on public.games (event_id, game_number)
  where event_id is not null and game_number is not null;
commit;
