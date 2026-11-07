begin;
create table public.request_limits (
  fingerprint text primary key check (fingerprint ~ '^[a-f0-9]{64}$'),
  attempts integer not null check (attempts > 0),
  resets_at timestamptz not null
);
create index request_limits_expiry on public.request_limits(resets_at);
alter table public.request_limits enable row level security;
revoke all on public.request_limits from public, anon, authenticated;

create function public.consume_request_limit(p_fingerprint text, p_limit integer, p_window_ms integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  n integer;
  instant timestamptz := clock_timestamp();
begin
  if p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_limit is null or p_limit not between 1 and 1000
    or p_window_ms is null or p_window_ms not between 1000 and 3600000 then
    raise exception 'Invalid request limit';
  end if;
  delete from public.request_limits where fingerprint in (
    select fingerprint from public.request_limits
    where resets_at < instant - interval '1 hour'
    order by resets_at limit 100 for update skip locked
  );
  insert into public.request_limits as existing (fingerprint, attempts, resets_at)
    values (p_fingerprint, 1, instant + p_window_ms * interval '1 millisecond')
  on conflict (fingerprint) do update set
    attempts = case when existing.resets_at <= instant then 1 else least(existing.attempts + 1, 1001) end,
    resets_at = case when existing.resets_at <= instant then excluded.resets_at else existing.resets_at end
  returning attempts into n;
  return n <= p_limit;
end;
$$;
revoke all on function public.consume_request_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_request_limit(text, integer, integer) to service_role;
commit;
