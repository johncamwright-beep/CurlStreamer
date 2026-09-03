-- Atomically creates an authenticated account's first team. This RPC is
-- intentionally callable only by the server-side service role.
create function public.create_first_team(p_user_id uuid, p_team_name text)
returns table (organization_id uuid, team_name text, membership_role public.team_membership_role)
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_name text := regexp_replace(trim(p_team_name), '\s+', ' ', 'g');
  existing_membership record;
  new_organization_id uuid;
begin
  if normalized_name is null or length(normalized_name) = 0 or length(normalized_name) > 100 then
    raise exception 'invalid team name' using errcode = '22023';
  end if;

  -- A per-user transaction lock makes concurrent submissions idempotent.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  if not exists (
    select 1 from public.user_profiles
    where user_id = p_user_id and status = 'active'
  ) then
    raise exception 'active account required' using errcode = '42501';
  end if;

  select tm.organization_id, o.name, tm.role
    into existing_membership
  from public.team_memberships tm
  join public.organizations o on o.id = tm.organization_id
  where tm.user_id = p_user_id and tm.status = 'active'
  order by tm.created_at
  limit 1;

  if found then
    return query select existing_membership.organization_id,
      existing_membership.name, existing_membership.role;
    return;
  end if;

  insert into public.organizations (name)
  values (normalized_name)
  returning id into new_organization_id;

  insert into public.team_memberships (organization_id, user_id, role, status)
  values (new_organization_id, p_user_id, 'owner', 'active');

  insert into public.audit_events (
    actor_user_id, organization_id, action, subject_type,
    subject_identifier, metadata
  ) values (
    p_user_id, new_organization_id, 'team.created', 'organization',
    new_organization_id::text, jsonb_build_object('initial_role', 'owner')
  );

  return query select new_organization_id, normalized_name,
    'owner'::public.team_membership_role;
end;
$$;

revoke all privileges on function public.create_first_team(uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.create_first_team(uuid, text) to service_role;

notify pgrst, 'reload schema';
