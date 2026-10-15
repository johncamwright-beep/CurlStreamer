-- Sponsor websites are optional public metadata. The RPC defaults preserve
-- existing callers while the application deployment rolls out.
begin;

alter table public.organization_sponsors
  add column website text check (
    website is null or website ~ '^https://[^[:space:]]+$'
  );

drop function public.list_organization_sponsors(uuid);
drop function public.list_game_organization_sponsors(uuid);
drop function public.list_sponsors_for_organization(uuid);
drop function public.create_organization_sponsor(uuid,uuid,text,text,text,text,bigint);
drop function public.update_organization_sponsor(uuid,uuid,text,text,boolean);

create function public.list_organization_sponsors(p_user_id uuid)
returns table(id uuid,display_name text,alt_text text,storage_path text,mime_type text,byte_size bigint,"position" integer,archived_at timestamptz,website text)
language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.sponsor_team(p_user_id,false);
begin
  return query select s.id,s.display_name,s.alt_text,s.storage_path,s.mime_type,s.byte_size,s."position",s.archived_at,s.website
  from public.organization_sponsors s where s.organization_id=v_org
  order by (s.archived_at is not null),s."position",s.id;
end; $$;

create function public.list_game_organization_sponsors(p_game_id uuid)
returns table(id uuid,display_name text,alt_text text,storage_path text,"position" integer,website text)
language plpgsql security definer set search_path='' as $$
begin
  return query select s.id,s.display_name,s.alt_text,s.storage_path,s."position",s.website
  from public.organization_sponsors s join public.games g on g.organization_id=s.organization_id
  where g.id=p_game_id and g.deleted_at is null and s.archived_at is null
  order by s."position",s.id;
end; $$;

create function public.list_sponsors_for_organization(p_organization_id uuid)
returns table(id uuid,display_name text,alt_text text,storage_path text,"position" integer,website text)
language sql security definer set search_path='' stable as $$
  select s.id,s.display_name,s.alt_text,s.storage_path,s."position",s.website
  from public.organization_sponsors s where s.organization_id=p_organization_id and s.archived_at is null
  order by s."position",s.id
$$;

create function public.create_organization_sponsor(
  p_user_id uuid,p_id uuid,p_name text,p_alt text,p_path text,p_mime text,
  p_size bigint,p_website text default null
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_org uuid:=public.sponsor_team(p_user_id,true);
  v_position integer;
  v_expected_path text;
begin
  if p_website is not null and btrim(p_website)<>'' and p_website !~ '^https://[^[:space:]]+$' then
    raise exception 'valid HTTPS website required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text,13));
  v_expected_path:=v_org::text||'/'||p_id::text||case p_mime
    when 'image/jpeg' then '.jpg' when 'image/png' then '.png'
    when 'image/webp' then '.webp' else '.invalid' end;
  if p_path<>v_expected_path then raise exception 'invalid server path' using errcode='22023'; end if;
  select coalesce(max(s."position")+1,0) into v_position
  from public.organization_sponsors s where s.organization_id=v_org;
  insert into public.organization_sponsors(id,organization_id,display_name,alt_text,storage_path,mime_type,byte_size,"position",website,created_by,updated_by)
  values(p_id,v_org,btrim(p_name),btrim(p_alt),p_path,p_mime,p_size,v_position,nullif(btrim(p_website),''),p_user_id,p_user_id);
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,'sponsor.created','sponsor',p_id::text,jsonb_build_object('display_name',left(btrim(p_name),100)));
  return p_id;
end; $$;

create function public.update_organization_sponsor(
  p_user_id uuid,p_id uuid,p_name text,p_alt text,p_archived boolean,
  p_website text default '__unchanged__'
) returns void language plpgsql security definer set search_path='' as $$
declare v_org uuid:=public.sponsor_team(p_user_id,true);
begin
  if p_website<>'__unchanged__' and btrim(p_website)<>'' and p_website !~ '^https://[^[:space:]]+$' then
    raise exception 'valid HTTPS website required' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text,13));
  update public.organization_sponsors s set
    display_name=btrim(p_name),alt_text=btrim(p_alt),
    website=case when p_website='__unchanged__' then s.website else nullif(btrim(p_website),'') end,
    "position"=case when not p_archived and s.archived_at is not null then
      (select coalesce(max(x."position")+1,0) from public.organization_sponsors x where x.organization_id=v_org and x.archived_at is null)
      else s."position" end,
    archived_at=case when p_archived then coalesce(s.archived_at,now()) else null end,
    updated_by=p_user_id,updated_at=now()
  where s.id=p_id and s.organization_id=v_org;
  if not found then raise exception 'sponsor unavailable' using errcode='42501'; end if;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
  values(p_user_id,v_org,case when p_archived then 'sponsor.archived' else 'sponsor.updated' end,'sponsor',p_id::text,jsonb_build_object('display_name',left(btrim(p_name),100)));
end; $$;

revoke all on function public.list_organization_sponsors(uuid),public.list_game_organization_sponsors(uuid),public.list_sponsors_for_organization(uuid),public.create_organization_sponsor(uuid,uuid,text,text,text,text,bigint,text),public.update_organization_sponsor(uuid,uuid,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.list_organization_sponsors(uuid),public.list_game_organization_sponsors(uuid),public.list_sponsors_for_organization(uuid),public.create_organization_sponsor(uuid,uuid,text,text,text,text,bigint,text),public.update_organization_sponsor(uuid,uuid,text,text,boolean,text) to service_role;

notify pgrst, 'reload schema';
commit;
