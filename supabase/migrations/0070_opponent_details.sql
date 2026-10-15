begin;

-- Identity and selected season details commit together. Existing games and
-- other seasons retain their snapshots; an opponent is never merged by name.
create function public.save_opponent_details(
  p_user_id uuid,
  p_opponent_id uuid,
  p_create boolean,
  p_display_name text,
  p_expected_display_name text,
  p_season_id uuid,
  p_level text,
  p_roster jsonb,
  p_expected_revision integer
)
returns table(opponent_id uuid, display_name text, season_id uuid, level text, roster jsonb, revision integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_name text;
  v_archived timestamptz;
  v_revision integer;
begin
  if p_user_id is null or p_opponent_id is null or p_season_id is null
    or p_create is null or p_display_name is null
    or length(btrim(p_display_name)) not between 1 and 100
    or p_expected_revision is null or p_expected_revision < 0
    or (p_create and p_expected_revision <> 0)
    or (not p_create and (p_expected_display_name is null
      or length(btrim(p_expected_display_name)) not between 1 and 100)) then
    raise exception 'valid opponent details required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null
  ) then
    raise exception 'confirmed account required' using errcode = '42501';
  end if;
  v_org := public.verified_team_for_operation(p_user_id, true);
  if not exists (
    select 1 from public.team_memberships m
    where m.organization_id = v_org and m.user_id = p_user_id
      and m.status = 'active' and m.role in ('owner', 'team_admin')
  ) then
    raise exception 'team administration required' using errcode = '42501';
  end if;
  perform 1 from public.seasons s
    where s.id = p_season_id and s.organization_id = v_org and s.status <> 'archived'
    for share;
  if not found then
    raise exception 'season unavailable' using errcode = '42501';
  end if;

  if p_create then
    insert into public.opponents(id, organization_id, display_name, created_by)
    values (p_opponent_id, v_org, btrim(p_display_name), p_user_id);
  else
    select o.display_name, o.archived_at into v_name, v_archived
    from public.opponents o where o.id = p_opponent_id and o.organization_id = v_org
    for update;
    if not found or v_archived is not null then
      raise exception 'opponent unavailable' using errcode = '42501';
    end if;
    if v_name is distinct from btrim(p_expected_display_name) then
      raise exception 'stale opponent name' using errcode = '40001';
    end if;
    update public.opponents o set display_name = btrim(p_display_name), updated_at = now()
    where o.id = p_opponent_id and o.organization_id = v_org;
  end if;

  -- Reuse canonical roster/level validation and optimistic season revision.
  -- Any failure rolls the identity change back in this same transaction.
  select saved.revision into v_revision
  from public.save_opponent_season(p_user_id, p_opponent_id, p_season_id,
    p_level, p_roster, p_expected_revision) saved;

  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (p_user_id, v_org, case when p_create then 'opponent.created' else 'opponent.updated' end,
    'opponent', p_opponent_id::text,
    jsonb_build_object('display_name', btrim(p_display_name), 'season_id', p_season_id, 'revision', v_revision));

  return query select o.id, o.display_name, os.season_id, os.level, os.roster, os.revision
  from public.opponents o join public.opponent_seasons os on os.opponent_id = o.id
    and os.organization_id = o.organization_id
  where o.id = p_opponent_id and o.organization_id = v_org and os.season_id = p_season_id;
end;
$$;

revoke all on function public.save_opponent_details(uuid, uuid, boolean, text, text, uuid, text, jsonb, integer)
from public, anon, authenticated, service_role;
grant execute on function public.save_opponent_details(uuid, uuid, boolean, text, text, uuid, text, jsonb, integer)
to service_role;

notify pgrst, 'reload schema';
commit;
