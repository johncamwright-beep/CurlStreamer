begin;

-- Only provider links with a saved Public policy belong in this public
-- projection. An organizer can paste any URL into game setup or end-game
-- review, so a manual link alone does not establish the video's visibility.
create or replace function public.read_public_team_games(p_org uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) from (
 select coalesce(c.completed_at,g.scheduled_start,g.created_at) stamp, jsonb_build_object(
 'id',g.id,'event_id',e.id,'event',e.name,'home',g.config->>'homeName','away',g.config->>'awayName',
 'opponent_slug',op.slug,'opponent_logo',op.logo_url,
 'number',g.game_number,'scheduled',g.scheduled_start,'timezone',coalesce(g.schedule_timezone,e.timezone),'completed',c.completed_at,
 'result',public.current_game_completion_result(c.game_id)->'totals',
 'youtube',case when g.config->>'youtubeVisibility'='public' then
   case
     when c.game_id is null and g.youtube_scheduled_status='ready' then g.youtube_scheduled_watch_url
     when c.game_id is not null and (
       (g.youtube_scheduled_status='ready' and c.youtube_watch_url=g.youtube_scheduled_watch_url)
       or exists (
         select 1 from public.broadcast_sessions s
         where s.game_id=g.id and s.organization_id=g.organization_id and s.provider='youtube'
           and s.started_at is not null and s.watch_url=c.youtube_watch_url
       )
     ) then c.youtube_watch_url
   end
 end) item
 from public.games g left join public.game_completions c on c.game_id=g.id
 left join public.events e on e.id=g.event_id and e.organization_id=g.organization_id
 left join public.opponents o on o.id=g.opponent_id and o.organization_id=g.organization_id
 left join public.team_public_profiles op on op.organization_id=o.linked_organization_id and op.settings->>'published'='true'
 join public.team_public_profiles p on p.organization_id=g.organization_id
 where g.organization_id=p_org and g.deleted_at is null and p.settings->>'published'='true'
 and ((c.game_id is not null and p.settings->>'results'='true') or
 (c.game_id is null and g.scheduled_start>=now()-interval '1 day' and p.settings->>'upcoming'='true'))
 order by coalesce(c.completed_at,g.scheduled_start,g.created_at) desc limit 100) rows;
$$;

notify pgrst, 'reload schema';
commit;
