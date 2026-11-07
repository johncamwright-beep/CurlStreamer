begin;
-- Independent, append-only review metadata: corrections never reopen scoring.
create table public.shot_tracker_review_corrections (
  sequence bigint generated always as identity primary key,
  request_id uuid not null unique,
  organization_id uuid not null references public.organizations(id),
  actor_user_id uuid not null references auth.users(id),
  game_id uuid not null references public.games(id),
  shot_id uuid not null,
  video_url text not null check (length(video_url) between 1 and 2000),
  start_seconds integer not null check (start_seconds between 0 and 604800),
  note text not null check (length(note) <= 4000),
  created_at timestamptz not null default now()
);
create index shot_tracker_review_corrections_lookup on public.shot_tracker_review_corrections
  (organization_id, actor_user_id, game_id, shot_id, sequence desc);
alter table public.shot_tracker_review_corrections enable row level security;
revoke all on public.shot_tracker_review_corrections from anon, authenticated, service_role;
grant select on public.shot_tracker_review_corrections to service_role;
create trigger shot_tracker_review_corrections_immutable before update or delete
on public.shot_tracker_review_corrections for each row
execute function public.reject_curlcoach_command_mutation();

create function public.save_shot_tracker_review_correction(
  p_actor uuid, p_org uuid, p_game uuid, p_shot uuid, p_request uuid,
  p_url text, p_start integer, p_note text
) returns void language plpgsql security definer set search_path = '' as $$
declare current_shot jsonb;
begin
  perform public.assert_curlcoach_actor(p_actor, p_org, p_game);
  if exists (select 1 from public.games where id=p_game and deleted_at is not null) then
    raise exception 'game unavailable' using errcode='42501';
  end if;
  select e->'shot' into current_shot from public.curlcoach_sessions s,
    lateral jsonb_array_elements(s.state->'events') with ordinality as entries(e,n)
    where s.organization_id=p_org and s.actor_user_id=p_actor and s.game_id=p_game
      and e->>'shotId'=p_shot::text order by n desc limit 1;
  if current_shot is null or current_shot='null'::jsonb or not coalesce(
    (current_shot->>'flagged')::boolean, nullif(current_shot->>'review','') is not null
  ) then raise exception 'flagged shot unavailable' using errcode='42501'; end if;
  if p_url !~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$' then
    raise exception 'invalid recording' using errcode='22023';
  end if;
  if exists(select 1 from public.shot_tracker_review_corrections where request_id=p_request) then
    if not exists(select 1 from public.shot_tracker_review_corrections where request_id=p_request
      and actor_user_id=p_actor and organization_id=p_org and game_id=p_game and shot_id=p_shot
      and video_url=p_url and start_seconds=p_start and note=p_note) then
      raise exception 'request conflict' using errcode='40001';
    end if;
    return;
  end if;
  insert into public.shot_tracker_review_corrections
    (request_id,organization_id,actor_user_id,game_id,shot_id,video_url,start_seconds,note)
    values(p_request,p_org,p_actor,p_game,p_shot,p_url,p_start,p_note);
end;
$$;
revoke all on function public.save_shot_tracker_review_correction(uuid,uuid,uuid,uuid,uuid,text,integer,text)
from public, anon, authenticated;
grant execute on function public.save_shot_tracker_review_correction(uuid,uuid,uuid,uuid,uuid,text,integer,text)
to service_role;
commit;
