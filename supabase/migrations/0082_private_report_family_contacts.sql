begin;
alter table public.team_player_contacts add column parent_email text
  check(parent_email is null or (length(parent_email)<=254 and parent_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'));
create table public.team_report_coach_contacts (
  organization_id uuid primary key references public.organizations(id),
  coach_email_1 text check(coach_email_1 is null or (length(coach_email_1)<=254 and coach_email_1 ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  coach_email_2 text check(coach_email_2 is null or (length(coach_email_2)<=254 and coach_email_2 ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')),
  updated_at timestamptz not null default now()
);
alter table public.team_report_coach_contacts enable row level security;
revoke all on public.team_report_coach_contacts from public,anon,authenticated;
grant select,insert,update on public.team_report_coach_contacts to service_role;
commit;
