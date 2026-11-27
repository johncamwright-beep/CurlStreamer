alter table public.team_news add column revision integer not null default 1;
alter table public.team_news add column deleted_at timestamptz;
-- Scoped writes, optimistic revisions, and stable IDs make retries safe.
create or replace function public.manage_team_news(
 p_org uuid, p_user uuid, p_id uuid, p_revision integer,
 p_summary text, p_photo text, p_replace_photo boolean, p_published boolean,
 p_game uuid default null, p_delete boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare item public.team_news;
begin
 if p_revision = 0 and not p_delete then
  if p_game is not null and not exists (
   select 1 from public.games g join public.game_completions c on c.game_id=g.id
   where g.id=p_game and g.organization_id=p_org and g.deleted_at is null
  ) then raise exception 'Completed team game required'; end if;
  insert into public.team_news(id,organization_id,game_id,summary,photo_url,published,created_by)
  values(p_id,p_org,p_game,p_summary,p_photo,p_published,p_user) on conflict(id) do nothing;
  select * into item from public.team_news where id=p_id and organization_id=p_org and deleted_at is null;
 else
  update public.team_news set
   summary=case when p_delete then summary else p_summary end,
   photo_url=case when not p_delete and p_replace_photo then p_photo else photo_url end,
   published=case when p_delete then false else p_published end,
   deleted_at=case when p_delete then now() else null end,
   revision=revision+1
  where id=p_id and organization_id=p_org and revision=p_revision and deleted_at is null
  returning * into item;
 end if;
 if item.id is null then raise exception 'Post changed or unavailable' using errcode='40001'; end if;
 return jsonb_build_object('id',item.id,'revision',item.revision,'photo_url',item.photo_url);
end; $$;
revoke all on function public.manage_team_news(uuid,uuid,uuid,integer,text,text,boolean,boolean,uuid,boolean) from public,anon,authenticated;
grant execute on function public.manage_team_news(uuid,uuid,uuid,integer,text,text,boolean,boolean,uuid,boolean) to service_role;
notify pgrst, 'reload schema';
