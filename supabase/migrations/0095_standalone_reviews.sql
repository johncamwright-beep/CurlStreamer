begin;
-- Review bookmarks are not attempts and never contribute to scoring statistics.
create table public.shot_tracker_standalone_reviews (
 request_id uuid primary key,
 organization_id uuid not null references public.organizations(id),
 actor_user_id uuid not null references auth.users(id),
 game_id uuid not null references public.games(id),
 audience text not null check(audience in ('player','team')),
 player_id text,
 player_name text,
 note text not null check(length(note)<=2000),
 selected_at timestamptz not null,
 created_at timestamptz not null default now(),
 check ((audience='team' and player_id is null and player_name is null) or
        (audience='player' and player_id is not null and player_name is not null and length(player_id) between 1 and 100 and length(player_name) between 1 and 200))
);
create index standalone_reviews_game on public.shot_tracker_standalone_reviews(organization_id,actor_user_id,game_id);
alter table public.shot_tracker_standalone_reviews enable row level security;
revoke all on public.shot_tracker_standalone_reviews from anon,authenticated,service_role;
grant select on public.shot_tracker_standalone_reviews to service_role;
create trigger standalone_reviews_immutable before update or delete on public.shot_tracker_standalone_reviews
 for each row execute function public.reject_curlcoach_command_mutation();
create function public.save_standalone_review(p_actor uuid,p_org uuid,p_game uuid,p_request uuid,p_audience text,p_player text,p_name text,p_note text,p_selected timestamptz)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform public.assert_curlcoach_actor(p_actor,p_org,p_game);
 if exists(select 1 from public.games where id=p_game and deleted_at is not null) then
  raise exception 'game unavailable' using errcode='42501';
 end if;
 insert into public.shot_tracker_standalone_reviews(request_id,organization_id,actor_user_id,game_id,audience,player_id,player_name,note,selected_at)
 values(p_request,p_org,p_actor,p_game,p_audience,p_player,p_name,p_note,p_selected) on conflict(request_id) do nothing;
 if not exists(select 1 from public.shot_tracker_standalone_reviews where request_id=p_request
  and organization_id=p_org and actor_user_id=p_actor and game_id=p_game and audience=p_audience
  and player_id is not distinct from p_player and player_name is not distinct from p_name
  and note=p_note and selected_at=p_selected) then
  raise exception 'request conflict' using errcode='40001';
 end if;
end;
$$;
revoke all on function public.save_standalone_review(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.save_standalone_review(uuid,uuid,uuid,uuid,text,text,text,text,timestamptz) to service_role;
commit;
