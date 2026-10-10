begin;

-- Opponents are a durable team-scoped identity. This table holds only the
-- season-specific scouting snapshot, so prior seasons remain historically
-- accurate when an opponent changes lineup or level.
create table public.opponent_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  opponent_id uuid not null,
  season_id uuid not null,
  level text check (level is null or level in ('U15', 'U18', 'U20', 'U25', 'Men’s', 'Women’s')),
  roster jsonb not null default '{}'::jsonb check (
    jsonb_typeof(roster) = 'object'
    and roster - array['lead', 'second', 'third', 'fourth', 'alternate', 'coach'] = '{}'::jsonb
  ),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (opponent_id, season_id),
  foreign key (opponent_id, organization_id)
    references public.opponents (id, organization_id) on delete restrict,
  foreign key (season_id, organization_id)
    references public.seasons (id, organization_id) on delete restrict
);

create index opponent_seasons_organization_season_idx
  on public.opponent_seasons (organization_id, season_id, opponent_id);

-- Existing games already identify the historical opponent-season pairing.
-- Backfill only empty snapshots; do not infer a roster or competitive level.
insert into public.opponent_seasons (organization_id, opponent_id, season_id)
select distinct g.organization_id, g.opponent_id, g.season_id
from public.games g
where g.opponent_id is not null and g.season_id is not null
on conflict (opponent_id, season_id) do nothing;

alter table public.opponent_seasons enable row level security;
revoke all privileges on table public.opponent_seasons
from public, anon, authenticated, service_role;
grant select, insert, update on table public.opponent_seasons to service_role;

create function public.list_opponent_seasons(
  p_user_id uuid,
  p_season_id uuid default null
)
returns table(
  opponent_id uuid,
  season_id uuid,
  level text,
  roster jsonb,
  revision integer
)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid;
begin
  if p_user_id is null then
    raise exception 'user required' using errcode = '22023';
  end if;
  v_org := public.verified_team_for_operation(p_user_id, false);
  if p_season_id is not null and not exists (
    select 1 from public.seasons s where s.id = p_season_id and s.organization_id = v_org
  ) then
    raise exception 'season unavailable' using errcode = '23514';
  end if;

  return query
  select os.opponent_id, os.season_id, os.level, os.roster, os.revision
  from public.opponent_seasons os
  where os.organization_id = v_org
    and (p_season_id is null or os.season_id = p_season_id)
  order by os.season_id, os.opponent_id;
end;
$$;

create function public.save_opponent_season(
  p_user_id uuid,
  p_opponent_id uuid,
  p_season_id uuid,
  p_level text,
  p_roster jsonb,
  p_expected_revision integer
)
returns table(
  opponent_id uuid,
  season_id uuid,
  level text,
  roster jsonb,
  revision integer
)
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_roster jsonb;
  v_revision integer;
begin
  if p_user_id is null or p_opponent_id is null or p_season_id is null
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'valid opponent season identifiers and revision required' using errcode = '22023';
  end if;
  v_org := public.verified_team_for_operation(p_user_id, true);
  if p_level is not null and p_level not in ('U15', 'U18', 'U20', 'U25', 'Men’s', 'Women’s') then
    raise exception 'valid opponent season level required' using errcode = '22023';
  end if;
  if p_roster is null or jsonb_typeof(p_roster) <> 'object' then
    raise exception 'opponent roster object required' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_roster) as key_name
    where key_name not in ('lead', 'second', 'third', 'fourth', 'alternate', 'coach')
  ) or exists (
    select 1 from jsonb_each(p_roster) as entry(key_name, value)
    where jsonb_typeof(value) <> 'string'
      or length(btrim(value #>> '{}')) > 100
  ) then
    raise exception 'valid opponent roster names required' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(entry.key_name, to_jsonb(btrim(entry.value))), '{}'::jsonb)
    into v_roster
  from jsonb_each_text(p_roster) as entry(key_name, value);

  if not exists (
    select 1 from public.opponents o
    where o.id = p_opponent_id and o.organization_id = v_org
  ) then
    raise exception 'opponent unavailable' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.seasons s
    where s.id = p_season_id and s.organization_id = v_org
  ) then
    raise exception 'season unavailable' using errcode = '23514';
  end if;

  update public.opponent_seasons os
  set level = p_level,
      roster = v_roster,
      revision = os.revision + 1,
      updated_at = now()
  where os.organization_id = v_org
    and os.opponent_id = p_opponent_id
    and os.season_id = p_season_id
    and os.revision = p_expected_revision
  returning os.revision into v_revision;

  if not found and p_expected_revision = 0 then
    insert into public.opponent_seasons (
      organization_id, opponent_id, season_id, level, roster, revision
    )
    values (v_org, p_opponent_id, p_season_id, p_level, v_roster, 1)
    on conflict on constraint opponent_seasons_opponent_id_season_id_key do nothing
    returning opponent_seasons.revision into v_revision;
  end if;
  if v_revision is null then
    raise exception 'stale opponent season profile' using errcode = '40001';
  end if;

  insert into public.audit_events(actor_user_id, organization_id, action, subject_type, subject_identifier, metadata)
  values (
    p_user_id, v_org, 'opponent_season.saved', 'opponent_season',
    p_opponent_id::text || ':' || p_season_id::text,
    jsonb_build_object('season_id', p_season_id, 'has_level', p_level is not null, 'revision', v_revision)
  );

  return query
  select os.opponent_id, os.season_id, os.level, os.roster, os.revision
  from public.opponent_seasons os
  where os.organization_id = v_org
    and os.opponent_id = p_opponent_id
    and os.season_id = p_season_id;
end;
$$;

revoke all on function public.list_opponent_seasons(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function public.save_opponent_season(uuid, uuid, uuid, text, jsonb, integer)
from public, anon, authenticated, service_role;
grant execute on function public.list_opponent_seasons(uuid, uuid) to service_role;
grant execute on function public.save_opponent_season(uuid, uuid, uuid, text, jsonb, integer) to service_role;

notify pgrst, 'reload schema';

commit;
