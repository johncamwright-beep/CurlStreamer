begin;

create table public.pilot_waitlist (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and length(email) <= 254),
  team text not null default '' check (length(team) <= 120),
  consent_version text not null default 'pilot-2026-09-11',
  created_at timestamptz not null default now()
);
alter table public.pilot_waitlist enable row level security;
revoke all on public.pilot_waitlist from anon, authenticated;
grant select, insert, delete on public.pilot_waitlist to service_role;

create table public.pilot_waitlist_limits (
  fingerprint text primary key,
  attempts integer not null,
  resets_at timestamptz not null
);
alter table public.pilot_waitlist_limits enable row level security;
revoke all on public.pilot_waitlist_limits from anon, authenticated;

create function public.join_pilot_waitlist(p_email text, p_team text, p_fingerprint text)
returns text language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if length(p_fingerprint) <> 64 or length(p_email) > 254 or length(p_team) > 120 then
    raise exception 'Invalid request';
  end if;
  delete from public.pilot_waitlist_limits where resets_at < now();
  insert into public.pilot_waitlist_limits(fingerprint,attempts,resets_at)
  values(p_fingerprint,1,now()+interval '1 hour')
  on conflict (fingerprint) do update set attempts=public.pilot_waitlist_limits.attempts+1
  returning attempts into n;
  if n > 5 then return 'limited'; end if;
  insert into public.pilot_waitlist(email,team) values(lower(p_email),p_team)
  on conflict(email) do nothing;
  return 'saved';
end;
$$;
revoke all on function public.join_pilot_waitlist(text,text,text) from public, anon, authenticated;
grant execute on function public.join_pilot_waitlist(text,text,text) to service_role;

commit;
