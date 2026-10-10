-- Durable, one-use recording links for multiple web server instances.
-- Scope contains only game/org/session UUIDs. Raw codes and media are never stored.
create table public.m3_program_grants (
  game_id uuid primary key references public.games(id) on delete cascade,
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  scope jsonb not null check (jsonb_typeof(scope) = 'object'),
  expires_at timestamptz not null
);
alter table public.m3_program_grants enable row level security;
revoke all on public.m3_program_grants from public, anon, authenticated;
grant select, insert, update, delete on public.m3_program_grants to service_role;
notify pgrst, 'reload schema';
