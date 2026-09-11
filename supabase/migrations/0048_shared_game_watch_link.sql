begin;

-- A validated shared link lives in the game configuration, so no new table
-- column is needed. Prefer it for both upcoming games and completed results.
create or replace function public.read_public_team_games(p_org uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(item order by stamp desc),'[]'::jsonb) from (
 select coalesce(c.completed_at,g.scheduled_start,g.created_at) stamp, jsonb_build_object(
 'id',g.id,'event_id',e.id,'event',e.name,'home',g.config->>'homeName','away',g.config->>'awayName',
 'opponent_slug',op.slug,'opponent_logo',op.logo_url,
 'number',g.game_number,'scheduled',g.scheduled_start,'completed',c.completed_at,
 'result',c.result->'totals','youtube',coalesce(nullif(btrim(g.config->>'sharedYoutubeWatchUrl'),''),case when c.game_id is not null then c.youtube_watch_url else g.youtube_scheduled_watch_url end)) item
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
