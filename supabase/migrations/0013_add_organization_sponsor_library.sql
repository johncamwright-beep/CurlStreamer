-- Private, organization-scoped sponsor library. Apply only after the matching
-- application Preview is green.
create table public.organization_sponsors (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  display_name text not null check(length(btrim(display_name)) between 1 and 100),
  alt_text text not null check(length(btrim(alt_text)) between 1 and 240),
  storage_path text not null unique check(storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  byte_size bigint not null check(byte_size between 1 and 12582912),
  "position" integer not null check("position" >= 0),
  archived_at timestamptz,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index organization_sponsors_active_idx on public.organization_sponsors(organization_id,archived_at,"position",id);
create unique index organization_sponsors_active_position_idx on public.organization_sponsors(organization_id,"position") where archived_at is null;
alter table public.organization_sponsors enable row level security;
revoke all on public.organization_sponsors from public,anon,authenticated;
grant select,insert,update on public.organization_sponsors to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('organization-sponsors','organization-sponsors',false,12582912,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
-- The application service role is the only storage principal. There are
-- deliberately no storage.objects policies for browser roles.

create function public.sponsor_team(p_user_id uuid,p_write boolean) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_org uuid; v_count integer;
begin
 if not exists(select 1 from public.user_profiles where user_id=p_user_id and status='active') then raise exception 'active account required' using errcode='42501'; end if;
 select count(*),min(organization_id::text)::uuid into v_count,v_org from public.team_memberships where user_id=p_user_id and status='active';
 if v_count<>1 then raise exception 'exactly one active team required' using errcode='42501'; end if;
 if p_write and not exists(select 1 from public.team_memberships where user_id=p_user_id and organization_id=v_org and status='active' and role in ('owner','team_admin')) then raise exception 'team administrator required' using errcode='42501'; end if;
 return v_org;
end; $$;

create function public.list_organization_sponsors(p_user_id uuid) returns table(id uuid,display_name text,alt_text text,storage_path text,mime_type text,byte_size bigint,"position" integer,archived_at timestamptz)
language plpgsql security definer set search_path='' as $$ declare v_org uuid:=public.sponsor_team(p_user_id,false); begin
 return query select s.id,s.display_name,s.alt_text,s.storage_path,s.mime_type,s.byte_size,s."position",s.archived_at from public.organization_sponsors s where s.organization_id=v_org order by (s.archived_at is not null),s."position",s.id;
end; $$;

create function public.list_game_organization_sponsors(p_game_id uuid) returns table(id uuid,display_name text,alt_text text,storage_path text,"position" integer)
language plpgsql security definer set search_path='' as $$ begin
 return query select s.id,s.display_name,s.alt_text,s.storage_path,s."position" from public.organization_sponsors s join public.games g on g.organization_id=s.organization_id where g.id=p_game_id and g.deleted_at is null and s.archived_at is null order by s."position",s.id;
end; $$;

-- Account game requests use their already verified organization identifier;
-- this boundary never accepts identifiers from a browser.
create function public.list_sponsors_for_organization(p_organization_id uuid) returns table(id uuid,display_name text,alt_text text,storage_path text,"position" integer)
language sql security definer set search_path='' stable as $$
 select s.id,s.display_name,s.alt_text,s.storage_path,s."position" from public.organization_sponsors s where s.organization_id=p_organization_id and s.archived_at is null order by s."position",s.id
$$;

create function public.create_organization_sponsor(p_user_id uuid,p_id uuid,p_name text,p_alt text,p_path text,p_mime text,p_size bigint) returns uuid
language plpgsql security definer set search_path='' as $$
declare
 v_org uuid:=public.sponsor_team(p_user_id,true);
 v_position integer;
 v_expected_path text;
begin
 perform pg_advisory_xact_lock(hashtextextended(v_org::text,13));
 v_expected_path:=v_org::text||'/'||p_id::text||case p_mime
  when 'image/jpeg' then '.jpg'
  when 'image/png' then '.png'
  when 'image/webp' then '.webp'
  else '.invalid'
 end;
 if p_path<>v_expected_path then
  raise exception 'invalid server path' using errcode='22023';
 end if;
 select coalesce(max(s."position")+1,0) into v_position from public.organization_sponsors s where s.organization_id=v_org;
 insert into public.organization_sponsors(id,organization_id,display_name,alt_text,storage_path,mime_type,byte_size,"position",created_by,updated_by) values(p_id,v_org,btrim(p_name),btrim(p_alt),p_path,p_mime,p_size,v_position,p_user_id,p_user_id);
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user_id,v_org,'sponsor.created','sponsor',p_id::text,jsonb_build_object('display_name',left(btrim(p_name),100)));
 return p_id;
end; $$;

create function public.update_organization_sponsor(p_user_id uuid,p_id uuid,p_name text,p_alt text,p_archived boolean) returns void
language plpgsql security definer set search_path='' as $$ declare v_org uuid:=public.sponsor_team(p_user_id,true); begin
 perform pg_advisory_xact_lock(hashtextextended(v_org::text,13));
 update public.organization_sponsors s set display_name=btrim(p_name),alt_text=btrim(p_alt),"position"=case when not p_archived and s.archived_at is not null then (select coalesce(max(x."position")+1,0) from public.organization_sponsors x where x.organization_id=v_org and x.archived_at is null) else s."position" end,archived_at=case when p_archived then coalesce(s.archived_at,now()) else null end,updated_by=p_user_id,updated_at=now() where s.id=p_id and s.organization_id=v_org;
 if not found then raise exception 'sponsor unavailable' using errcode='42501'; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user_id,v_org,case when p_archived then 'sponsor.archived' else 'sponsor.updated' end,'sponsor',p_id::text,jsonb_build_object('display_name',left(btrim(p_name),100)));
end; $$;

create function public.reorder_organization_sponsors(p_user_id uuid,p_ids uuid[]) returns void
language plpgsql security definer set search_path='' as $$ declare v_org uuid:=public.sponsor_team(p_user_id,true); begin
 if cardinality(p_ids)<>(select count(*) from public.organization_sponsors where organization_id=v_org and archived_at is null) or exists(select 1 from unnest(p_ids) x left join public.organization_sponsors s on s.id=x and s.organization_id=v_org and s.archived_at is null where s.id is null) then raise exception 'complete active ordering required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(v_org::text,13));
 update public.organization_sponsors s set "position"=s."position"+1000000 where s.organization_id=v_org and s.archived_at is null;
 update public.organization_sponsors s set "position"=x.ordinality-1,updated_by=p_user_id,updated_at=now() from unnest(p_ids) with ordinality x(id,ordinality) where s.id=x.id and s.organization_id=v_org;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user_id,v_org,'sponsors.reordered','organization',v_org::text,jsonb_build_object('count',cardinality(p_ids)));
end; $$;

create function public.replace_organization_sponsor(p_user_id uuid,p_id uuid,p_path text,p_mime text,p_size bigint) returns text
language plpgsql security definer set search_path='' as $$ declare v_org uuid:=public.sponsor_team(p_user_id,true); v_old text; begin
 if split_part(p_path,'/',1)<>v_org::text then raise exception 'invalid server path' using errcode='22023'; end if;
 select storage_path into v_old from public.organization_sponsors where id=p_id and organization_id=v_org for update;
 update public.organization_sponsors set storage_path=p_path,mime_type=p_mime,byte_size=p_size,updated_by=p_user_id,updated_at=now() where id=p_id and organization_id=v_org;
 if not found then raise exception 'sponsor unavailable' using errcode='42501'; end if;
 insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata) values(p_user_id,v_org,'sponsor.replaced','sponsor',p_id::text,'{}'); return v_old;
end; $$;

create function public.rollback_organization_sponsor(p_user_id uuid,p_id uuid) returns void
language plpgsql security definer set search_path='' as $$ declare v_org uuid:=public.sponsor_team(p_user_id,true); begin
 delete from public.organization_sponsors where id=p_id and organization_id=v_org and created_by=p_user_id;
 if not found then raise exception 'sponsor unavailable' using errcode='42501'; end if;
end; $$;

revoke all on function public.sponsor_team(uuid,boolean),public.list_organization_sponsors(uuid),public.list_game_organization_sponsors(uuid),public.list_sponsors_for_organization(uuid),public.create_organization_sponsor(uuid,uuid,text,text,text,text,bigint),public.update_organization_sponsor(uuid,uuid,text,text,boolean),public.reorder_organization_sponsors(uuid,uuid[]),public.replace_organization_sponsor(uuid,uuid,text,text,bigint),public.rollback_organization_sponsor(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.sponsor_team(uuid,boolean),public.list_organization_sponsors(uuid),public.list_game_organization_sponsors(uuid),public.list_sponsors_for_organization(uuid),public.create_organization_sponsor(uuid,uuid,text,text,text,text,bigint),public.update_organization_sponsor(uuid,uuid,text,text,boolean),public.reorder_organization_sponsors(uuid,uuid[]),public.replace_organization_sponsor(uuid,uuid,text,text,bigint),public.rollback_organization_sponsor(uuid,uuid) to service_role;
notify pgrst,'reload schema';
