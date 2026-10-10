begin;
-- A local opponent remains owned by its original team. Linking grants no
-- access to the other team's games, members, credentials, or private profile.
alter table public.opponents add column linked_organization_id uuid
  references public.organizations(id) on delete set null;
alter table public.opponents add constraint opponent_cannot_link_self
  check (linked_organization_id is distinct from organization_id);
create unique index opponents_linked_team_unique on public.opponents
  (organization_id, linked_organization_id) where linked_organization_id is not null;

create function public.search_opponent_profiles(p_user_id uuid, p_query text)
returns table(organization_id uuid, name text, slug text, logo_url text, description text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  if length(btrim(p_query)) < 2 or length(p_query) > 100 then return; end if;
  return query select p.organization_id, left(coalesce(nullif(p.settings->>'name',''),o.name),100),
    p.slug, p.logo_url, left(coalesce(p.settings->>'description',''),180)
  from public.team_public_profiles p join public.organizations o on o.id=p.organization_id
  where p.organization_id<>v_org and p.settings->>'published'='true'
    and (strpos(lower(coalesce(p.settings->>'name',o.name)),lower(btrim(p_query)))>0
      or strpos(lower(p.slug),lower(btrim(p_query)))>0)
  order by coalesce(p.settings->>'name',o.name),p.organization_id limit 20;
end $$;

create function public.read_opponent_profile(p_user_id uuid, p_opponent_id uuid)
returns table(linked boolean, organization_id uuid, name text, slug text, logo_url text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id, false);
begin
  return query select o.linked_organization_id is not null, p.organization_id,
    left(p.settings->>'name',100),p.slug,p.logo_url
  from public.opponents o left join public.team_public_profiles p
    on p.organization_id=o.linked_organization_id and p.settings->>'published'='true'
  where o.id=p_opponent_id and o.organization_id=v_org;
end $$;

create function public.link_opponent_profile(p_user_id uuid, p_profile_id uuid, p_opponent_id uuid default null)
returns table(id uuid, display_name text)
language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public.verified_team_for_operation(p_user_id,true);
  v_id uuid; v_name text; v_current uuid; v_existing uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('opponent-profile:'||v_org::text,0));
  if p_opponent_id is not null then
    select o.id,o.display_name,o.linked_organization_id into v_id,v_name,v_current
      from public.opponents o where o.id=p_opponent_id and o.organization_id=v_org for update;
    if not found then raise exception 'opponent not owned by team' using errcode='42501'; end if;
  end if;
  if p_profile_id is null then
    if v_id is null then raise exception 'opponent required' using errcode='22023'; end if;
    update public.opponents set linked_organization_id=null,updated_at=now() where opponents.id=v_id;
  else
    if p_profile_id=v_org then raise exception 'cannot select own team' using errcode='22023'; end if;
    if not exists(select 1 from public.team_public_profiles p where p.organization_id=p_profile_id and p.settings->>'published'='true') then
      raise exception 'published team required' using errcode='22023';
    end if;
    select o.id into v_existing from public.opponents o where o.organization_id=v_org and o.linked_organization_id=p_profile_id;
    if v_existing is not null and v_id is not null and v_existing<>v_id then
      raise exception 'profile already linked to another opponent' using errcode='23505';
    end if;
    if v_id is null and v_existing is not null then
      select o.id,o.display_name into v_id,v_name from public.opponents o where o.id=v_existing;
    end if;
    if v_id is null then
      select left(coalesce(nullif(p.settings->>'name',''),o.name),100) into v_name
        from public.team_public_profiles p join public.organizations o on o.id=p.organization_id where p.organization_id=p_profile_id;
      select f.opponent_id, f.display_name into v_id,v_name from public.find_or_create_opponent(p_user_id,gen_random_uuid(),v_name) f;
      select o.linked_organization_id into v_current from public.opponents o where o.id=v_id;
      if v_current is not null and v_current<>p_profile_id then
        raise exception 'name already linked to another profile' using errcode='23505';
      end if;
    end if;
    update public.opponents set linked_organization_id=p_profile_id,archived_at=null,updated_at=now() where opponents.id=v_id;
  end if;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,case when p_profile_id is null then 'opponent.profile_unlinked' else 'opponent.profile_linked' end,
      'opponent',v_id::text,jsonb_build_object('profile_id',p_profile_id));
  return query select v_id,v_name;
end $$;

revoke all on function public.search_opponent_profiles(uuid,text), public.read_opponent_profile(uuid,uuid), public.link_opponent_profile(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.search_opponent_profiles(uuid,text), public.read_opponent_profile(uuid,uuid), public.link_opponent_profile(uuid,uuid,uuid) to service_role;
notify pgrst, 'reload schema';
commit;
