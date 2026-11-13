begin;

-- Enforce the lock below the API, including clients still running older code.
-- Lock the game row so completion and a coaching write have a definite order.
create or replace function public.guard_curlcoach_closed_game()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.games
    where id = new.game_id and organization_id = new.organization_id for share;
  if not found or v_status in ('completed', 'closed', 'deleted') then
    raise exception 'Closed games are read only in CurlCoach' using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and old.status = 'closed' then
    raise exception 'Closed coaching sessions are read only' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_curlcoach_closed_game() from public, anon, authenticated;
-- This protection was also applied with the authorized October 5 data repair.
-- Reapplying the migration must preserve that existing protection.
do $$
begin
  if not exists (select 1 from pg_trigger
    where tgrelid = 'public.curlcoach_sessions'::regclass
      and tgname = 'curlcoach_closed_game_guard') then
    create trigger curlcoach_closed_game_guard
    before insert or update on public.curlcoach_sessions
    for each row execute function public.guard_curlcoach_closed_game();
  end if;
end;
$$;

commit;
