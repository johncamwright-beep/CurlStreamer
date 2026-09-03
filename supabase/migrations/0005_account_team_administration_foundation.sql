-- Additive foundation for authenticated accounts, team membership, platform
-- administration, and future security auditing. Applying this migration does
-- not connect legacy organizer_users to auth.users or change runtime behavior.

create type public.account_status as enum (
  'active',
  'suspended',
  'deletion_pending'
);

create type public.team_membership_role as enum (
  'owner',
  'team_admin',
  'scorer',
  'viewer'
);

create type public.team_membership_status as enum (
  'active',
  'suspended',
  'removed'
);

create table public.user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.team_membership_role not null,
  status public.team_membership_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index team_memberships_one_active_per_user_organization
  on public.team_memberships (organization_id, user_id)
  where status = 'active';
create index team_memberships_user_id_idx
  on public.team_memberships (user_id);
create index team_memberships_organization_id_idx
  on public.team_memberships (organization_id);
create index team_memberships_active_owner_idx
  on public.team_memberships (organization_id)
  where status = 'active' and role = 'owner';

-- Serialize owner-removing changes per organization and reject the change if
-- it would leave an organization that had an active owner without one.
create function public.protect_final_active_team_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'active' and old.role = 'owner' and
     (tg_op = 'DELETE' or new.status <> 'active' or new.role <> 'owner' or
      new.organization_id <> old.organization_id) then
    perform pg_advisory_xact_lock(hashtextextended(old.organization_id::text, 0));

    if not exists (
      select 1
      from public.team_memberships
      where organization_id = old.organization_id
        and status = 'active'
        and role = 'owner'
        and id <> old.id
    ) then
      raise exception 'an organization cannot lose its final active owner'
        using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger protect_final_active_team_owner
before update or delete on public.team_memberships
for each row execute function public.protect_final_active_team_owner();

create table public.platform_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.platform_permissions (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table public.platform_role_permissions (
  role_id uuid not null references public.platform_roles (id) on delete cascade,
  permission_id uuid not null references public.platform_permissions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table public.user_platform_roles (
  user_id uuid not null references auth.users (id) on delete cascade,
  role_id uuid not null references public.platform_roles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);
create index user_platform_roles_role_id_idx
  on public.user_platform_roles (role_id);

insert into public.platform_roles (name, description)
values
  ('super_admin', 'Full platform administration'),
  ('support_admin', 'Limited support and account assistance');

insert into public.platform_permissions (name, description)
values
  ('platform_roles.manage', 'Manage platform role assignments'),
  ('accounts.read', 'Read account support information'),
  ('accounts.manage_status', 'Manage account status'),
  ('teams.read', 'Read team support information'),
  ('audit_events.read', 'Read platform audit events');

insert into public.platform_role_permissions (role_id, permission_id)
select roles.id, permissions.id
from public.platform_roles roles
cross join public.platform_permissions permissions
where roles.name = 'super_admin'
   or (roles.name = 'support_admin' and permissions.name in (
     'accounts.read',
     'teams.read',
     'audit_events.read'
   ));

create table public.audit_events (
  id bigint generated always as identity primary key,
  actor_user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  action text not null check (length(trim(action)) > 0),
  subject_type text not null check (length(trim(subject_type)) > 0),
  subject_identifier text not null check (length(trim(subject_identifier)) > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index audit_events_actor_user_id_idx on public.audit_events (actor_user_id);
create index audit_events_organization_id_idx on public.audit_events (organization_id);
create index audit_events_created_at_idx on public.audit_events (created_at desc);

create function public.prevent_audit_event_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit events are append-only' using errcode = '55000';
end;
$$;

create trigger prevent_audit_event_changes
before update or delete on public.audit_events
for each row execute function public.prevent_audit_event_changes();

alter table public.user_profiles enable row level security;
alter table public.team_memberships enable row level security;
alter table public.platform_roles enable row level security;
alter table public.platform_permissions enable row level security;
alter table public.platform_role_permissions enable row level security;
alter table public.user_platform_roles enable row level security;
alter table public.audit_events enable row level security;

revoke all privileges on table
  public.user_profiles,
  public.team_memberships,
  public.platform_roles,
  public.platform_permissions,
  public.platform_role_permissions,
  public.user_platform_roles,
  public.audit_events
from public, anon, authenticated, service_role;

-- Future server-only account and administration services need direct access;
-- browser roles remain deny-by-default and have no policies or grants.
grant select, insert, update, delete on table
  public.user_profiles,
  public.team_memberships,
  public.user_platform_roles
to service_role;
grant select on table
  public.platform_roles,
  public.platform_permissions,
  public.platform_role_permissions
to service_role;
grant select, insert on table public.audit_events to service_role;

revoke all privileges on sequence public.audit_events_id_seq
from public, anon, authenticated, service_role;
grant usage, select on sequence public.audit_events_id_seq to service_role;

revoke all privileges on function public.protect_final_active_team_owner()
from public, anon, authenticated, service_role;
revoke all privileges on function public.prevent_audit_event_changes()
from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
