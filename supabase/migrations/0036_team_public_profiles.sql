-- Team public content is private until an administrator explicitly publishes it.
create table public.team_public_profiles (
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 3 and 48 and slug not in ('www','api','auth','admin','app','studio','support','mail','account')),
 settings jsonb not null,
 logo_url text,
 updated_at timestamptz not null default now()
);
alter table public.team_public_profiles enable row level security;
revoke all on public.team_public_profiles from anon, authenticated;
grant select, insert, update on public.team_public_profiles to service_role;
create table public.team_news (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 game_id uuid references public.games(id) on delete set null,
 summary text not null check(length(summary) between 1 and 3000),
 photo_url text,
 published boolean not null default false,
 created_by uuid not null,
 created_at timestamptz not null default now()
);
alter table public.team_news enable row level security;
revoke all on public.team_news from anon, authenticated;
grant select, insert, update on public.team_news to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-public-media','team-public-media',true,4194304,array['image/jpeg','image/png','image/webp']) on conflict(id) do nothing;
-- No browser write policies: uploads go through an authenticated team-admin route.
create or replace function public.update_team_public_profile(p_org uuid, p_settings jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.organizations set name=p_settings->>'name' where id=p_org;
 insert into public.team_public_profiles(organization_id,slug,settings) values(p_org,p_settings->>'slug',p_settings)
 on conflict(organization_id) do update set slug=excluded.slug,settings=excluded.settings,updated_at=now();
end; $$;
revoke all on function public.update_team_public_profile(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.update_team_public_profile(uuid,jsonb) to service_role;
notify pgrst, 'reload schema';
create or replace function public.read_public_team_games(p_org uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
 select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) from (
 select coalesce(c.completed_at,g.scheduled_start,g.created_at) stamp, jsonb_build_object(
 'id',g.id,'event',g.config->>'eventName','home',g.config->>'homeName','away',g.config->>'awayName',
 'number',g.game_number,'scheduled',g.scheduled_start,'completed',c.completed_at,
 'result',c.result->'totals','youtube',c.youtube_watch_url) item
 from public.games g left join public.game_completions c on c.game_id=g.id
 join public.team_public_profiles p on p.organization_id=g.organization_id
 where g.organization_id=p_org and g.deleted_at is null and p.settings->>'published'='true'
 and ((c.game_id is not null and p.settings->>'results'='true') or
 (c.game_id is null and g.scheduled_start>=now()-interval '1 day' and p.settings->>'upcoming'='true'))
 order by coalesce(c.completed_at,g.scheduled_start,g.created_at) desc limit 100) rows;
$$;
revoke all on function public.read_public_team_games(uuid) from public,anon,authenticated;
grant execute on function public.read_public_team_games(uuid) to service_role;
create or replace function public.save_team_game_news(p_org uuid,p_user uuid,p_game uuid,p_summary text,p_photo text,p_published boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare news_id uuid;
begin
 if not exists(select 1 from public.games g join public.game_completions c on c.game_id=g.id where g.id=p_game and g.organization_id=p_org and g.deleted_at is null) then raise exception 'Completed team game required'; end if;
 insert into public.team_news(organization_id,game_id,summary,photo_url,published,created_by)
 values(p_org,p_game,p_summary,p_photo,p_published,p_user) returning id into news_id;
 return news_id;
end; $$;
revoke all on function public.save_team_game_news(uuid,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.save_team_game_news(uuid,uuid,uuid,text,text,boolean) to service_role;
notify pgrst, 'reload schema';
create or replace function public.read_game_team_logo(p_game uuid)
returns text language sql stable security definer set search_path = '' as $$
 select p.logo_url from public.team_public_profiles p join public.games g on g.organization_id=p.organization_id where g.id=p_game and g.deleted_at is null;
$$;
revoke all on function public.read_game_team_logo(uuid) from public,anon,authenticated;
grant execute on function public.read_game_team_logo(uuid) to service_role;
notify pgrst, 'reload schema';
