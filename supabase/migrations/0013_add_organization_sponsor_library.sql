-- Private, organization-level sponsor library. Apply only after a clean build.
create table public.organization_sponsors (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  display_name text not null check (length(trim(display_name)) between 1 and 120),
  alt_text text not null check (length(trim(alt_text)) between 1 and 240),
  storage_path text not null unique,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  bytes integer not null check (bytes > 0 and bytes <= 12582912),
  sort_order integer not null check (sort_order >= 0),
  archived_at timestamptz,
  created_by uuid not null references auth.users (id) on delete restrict,
  updated_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_sponsors_server_path check (
    storage_path = 'organizations/' || organization_id::text || '/sponsors/' || id::text
  )
);

create unique index organization_sponsors_order_active_idx
  on public.organization_sponsors (organization_id, sort_order)
  where archived_at is null;
create index organization_sponsors_archive_order_idx
  on public.organization_sponsors (organization_id, archived_at, sort_order, created_at, id);

alter table public.organization_sponsors enable row level security;
revoke all privileges on table public.organization_sponsors from public, anon, authenticated, service_role;
grant select, insert, update on table public.organization_sponsors to service_role;

-- Objects remain inaccessible to browser roles. The server signs individual reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'organization-sponsors', 'organization-sponsors', false, 12582912,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create function public.manage_organization_sponsor(
  p_user_id uuid,
  p_action text,
  p_sponsor_id uuid,
  p_display_name text default null,
  p_alt_text text default null,
  p_mime_type text default null,
  p_bytes integer default null,
  p_ordered_ids uuid[] default null
)
returns setof public.organization_sponsors
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_role public.team_membership_role;
  v_path text;
  v_order integer;
begin
  if not exists (select 1 from public.user_profiles where user_id = p_user_id and status = 'active') then
    raise exception 'sponsor operation unavailable' using errcode = '42501';
  end if;
  select min(organization_id::text)::uuid, min(role::text)::public.team_membership_role
    into v_org, v_role from public.team_memberships
    where user_id = p_user_id and status = 'active'
    having count(*) = 1;
  if v_org is null or v_role not in ('owner', 'team_admin') then
    raise exception 'sponsor operation unavailable' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text, 0));

  if p_action = 'create' then
    if p_mime_type not in ('image/jpeg','image/png','image/webp') or p_bytes <= 0 or p_bytes > 12582912 then
      raise exception 'invalid sponsor image' using errcode = '22023';
    end if;
    v_path := 'organizations/' || v_org::text || '/sponsors/' || p_sponsor_id::text;
    select coalesce(max(sort_order) + 1, 0) into v_order
      from public.organization_sponsors where organization_id = v_org and archived_at is null;
    insert into public.organization_sponsors
      (id, organization_id, display_name, alt_text, storage_path, mime_type, bytes, sort_order, created_by, updated_by)
    values (p_sponsor_id, v_org, trim(p_display_name), trim(p_alt_text), v_path, p_mime_type, p_bytes, v_order, p_user_id, p_user_id);
  elsif p_action in ('rename', 'replace', 'archive', 'restore') then
    if not exists (select 1 from public.organization_sponsors where id = p_sponsor_id and organization_id = v_org) then
      raise exception 'sponsor operation unavailable' using errcode = '42501';
    end if;
    if p_action = 'rename' then
      update public.organization_sponsors set display_name=trim(p_display_name), alt_text=trim(p_alt_text), updated_by=p_user_id, updated_at=now()
       where id=p_sponsor_id and organization_id=v_org;
    elsif p_action = 'replace' then
      if p_mime_type not in ('image/jpeg','image/png','image/webp') or p_bytes <= 0 or p_bytes > 12582912 then
        raise exception 'invalid sponsor image' using errcode = '22023';
      end if;
      update public.organization_sponsors set mime_type=p_mime_type, bytes=p_bytes, updated_by=p_user_id, updated_at=now()
       where id=p_sponsor_id and organization_id=v_org;
    elsif p_action = 'archive' then
      update public.organization_sponsors set archived_at=now(), updated_by=p_user_id, updated_at=now()
       where id=p_sponsor_id and organization_id=v_org and archived_at is null;
    else
      select coalesce(max(sort_order)+1,0) into v_order from public.organization_sponsors where organization_id=v_org and archived_at is null;
      update public.organization_sponsors set archived_at=null, sort_order=v_order, updated_by=p_user_id, updated_at=now()
       where id=p_sponsor_id and organization_id=v_org and archived_at is not null;
    end if;
  elsif p_action = 'reorder' then
    if cardinality(p_ordered_ids) <> (select count(*) from public.organization_sponsors where organization_id=v_org and archived_at is null)
       or cardinality(p_ordered_ids) <> (select count(distinct x) from unnest(p_ordered_ids) x)
       or exists (select 1 from unnest(p_ordered_ids) x where not exists (select 1 from public.organization_sponsors s where s.id=x and s.organization_id=v_org and s.archived_at is null)) then
      raise exception 'invalid sponsor order' using errcode = '22023';
    end if;
    -- Avoid the partial unique index while swapping positions.
    update public.organization_sponsors set sort_order=sort_order+100000 where organization_id=v_org and archived_at is null;
    update public.organization_sponsors s set sort_order=o.ordinality-1, updated_by=p_user_id, updated_at=now()
      from unnest(p_ordered_ids) with ordinality o(id, ordinality)
      where s.id=o.id and s.organization_id=v_org;
  else
    raise exception 'invalid sponsor operation' using errcode = '22023';
  end if;

  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_user_id, v_org, 'sponsor.'||p_action, 'organization_sponsor', p_sponsor_id::text,
    jsonb_build_object('source', 'sponsor_library'));
  return query select * from public.organization_sponsors where organization_id=v_org
    order by archived_at nulls first, sort_order, created_at, id;
end;
$$;

revoke all privileges on function public.manage_organization_sponsor(uuid,text,uuid,text,text,text,integer,uuid[])
from public, anon, authenticated, service_role;
grant execute on function public.manage_organization_sponsor(uuid,text,uuid,text,text,text,integer,uuid[])
to service_role;

notify pgrst, 'reload schema';
