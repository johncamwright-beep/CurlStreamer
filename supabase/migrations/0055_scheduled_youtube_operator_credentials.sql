-- Operators can schedule broadcasts for their own active games. Keep the
-- account-level credential and OAuth management RPCs administrator-only.
begin;

create function public.get_scheduled_youtube_credentials(
  p_user_id uuid,
  p_game_id uuid
)
returns table(
  organization_id uuid,
  encrypted_credentials text,
  channel_id text,
  connection_version bigint
)
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_org uuid := public.verified_game_operator(p_user_id);
begin
  perform 1 from public.authorize_game_broadcast_actor(p_game_id, p_user_id, false);
  if not exists (
    select 1 from public.games g
    where g.id = p_game_id and g.organization_id = v_org
      and g.deleted_at is null and g.completed_at is null and g.status = 'active'
      and coalesce((g.config->>'youtubeEnabled')::boolean, false)
  ) then
    raise exception 'scheduled game unavailable' using errcode = '42501';
  end if;
  return query
    select v_org, encode(b.encrypted_credentials, 'base64'), b.channel_id,
      b.connection_version
    from public.broadcast_settings b
    where b.organization_id = v_org and b.provider = 'youtube'
      and b.connection_status in ('connected', 'reconnect_required')
      and b.encrypted_credentials is not null and b.channel_id is not null;
end;
$$;

revoke all on function public.get_scheduled_youtube_credentials(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.get_scheduled_youtube_credentials(uuid, uuid)
to service_role;

notify pgrst, 'reload schema';
commit;
