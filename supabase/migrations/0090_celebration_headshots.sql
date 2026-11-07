begin;
create table public.team_celebration_headshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roster_player_id text not null check (roster_player_id ~ '^[a-f0-9]{64}$'),
  player_name text not null check (length(player_name) between 1 and 200),
  person_kind text not null default 'roster' check (person_kind in ('roster','coach')),
  storage_path text not null,
  updated_at timestamptz not null default now(),
  unique (organization_id, roster_player_id),
  check (storage_path like organization_id::text || '/%')
);
-- A coach is a separate celebration person, never a fifth curling roster slot.
create unique index team_celebration_one_coach on public.team_celebration_headshots (organization_id) where person_kind='coach';
alter table public.team_celebration_headshots enable row level security;
revoke all on public.team_celebration_headshots from public, anon, authenticated;
grant select,insert,update,delete on public.team_celebration_headshots to service_role;
-- Private storage: authorized rendering receives short-lived signed URLs.
-- Uploads are accepted exclusively by the authorized server route.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('celebration-headshots','celebration-headshots',false,2097152,array['image/png'])
on conflict (id) do nothing;
commit;
