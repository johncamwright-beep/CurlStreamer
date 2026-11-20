begin;
-- One profile per organization is already enforced by its primary key.
-- Lock the first published address even for writes outside the settings RPC.
create function public.protect_published_team_address()
returns trigger language plpgsql set search_path='' as $$
begin
 if old.settings->>'published'='true' and
   (new.organization_id is distinct from old.organization_id or
    new.slug is distinct from old.slug or
    new.settings->>'slug' is distinct from old.slug or
    new.settings->>'published' is distinct from 'true') then
   raise exception 'Published team address is permanent' using errcode='23514';
 end if;
 return new;
end $$;
create trigger protect_published_team_address before update on public.team_public_profiles
for each row execute function public.protect_published_team_address();
revoke all on function public.protect_published_team_address() from public,anon,authenticated;

drop function public.update_team_public_profile(uuid,jsonb);
create function public.update_team_public_profile(p_org uuid,p_settings jsonb,p_publish boolean default false)
returns void language plpgsql security definer set search_path='' as $$
declare prior jsonb;
begin
 -- Serialize first publication and competing saves for the same team.
 perform pg_advisory_xact_lock(hashtextextended(p_org::text,41));
 select settings into prior from public.team_public_profiles where organization_id=p_org for update;
 if p_settings->>'published'='true' and coalesce(prior->>'published','false')<>'true' and not p_publish then
   raise exception 'Explicit publication confirmation required' using errcode='22023';
 end if;
 update public.organizations set name=p_settings->>'name' where id=p_org;
 insert into public.team_public_profiles(organization_id,slug,settings) values(p_org,p_settings->>'slug',p_settings)
 on conflict(organization_id) do update set slug=excluded.slug,settings=excluded.settings,updated_at=now();
end $$;
revoke all on function public.update_team_public_profile(uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.update_team_public_profile(uuid,jsonb,boolean) to service_role;
notify pgrst, 'reload schema';
commit;
