-- Test-only stand-in for the Realtime catalog; does not simulate WebSocket delivery.
create schema realtime;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic',true) $$;
create table realtime.messages(id bigint generated always as identity, extension text not null, topic text not null);
alter table realtime.messages enable row level security;
grant usage on schema realtime,auth to authenticated,anon,service_role;
grant select,insert on realtime.messages to authenticated;
grant usage on all sequences in schema realtime to authenticated;
