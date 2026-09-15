-- Run after migration 0057. Test counters are rolled back; no team data is read.
begin;
do $$
declare key text := md5(gen_random_uuid()::text) || md5(gen_random_uuid()::text);
begin
  if not public.consume_request_limit(key, 2, 60000) then raise exception 'First request denied'; end if;
  if not public.consume_request_limit(key, 2, 60000) then raise exception 'Second request denied'; end if;
  if public.consume_request_limit(key, 2, 60000) then raise exception 'Limit bypassed'; end if;
  update public.request_limits set resets_at = now() - interval '1 second' where fingerprint = key;
  if not public.consume_request_limit(key, 2, 60000) then raise exception 'Expired window did not reset'; end if;
  if has_function_privilege('anon', 'public.consume_request_limit(text,integer,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.consume_request_limit(text,integer,integer)', 'EXECUTE')
    then raise exception 'Public execute allowed'; end if;
  if not has_function_privilege('service_role', 'public.consume_request_limit(text,integer,integer)', 'EXECUTE')
    then raise exception 'Server execute denied'; end if;
  if has_table_privilege('anon', 'public.request_limits', 'SELECT')
    or has_table_privilege('authenticated', 'public.request_limits', 'SELECT')
    then raise exception 'Public table access'; end if;
end $$;
rollback;
