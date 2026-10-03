begin;

-- Pending/failed reservations have not sent a provider insert. Preserve the
-- game marker for discovery, but reserve creation quarantine for actual intents.
-- This changes only first session adoption; running sessions are untouched.
create or replace function public.adopt_scheduled_youtube_broadcast()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_game public.games;
begin
 if new.provider='youtube' then
   select * into v_game from public.games where id=new.game_id;
   if v_game.youtube_scheduled_status='intent' and v_game.youtube_scheduled_updated_at > now()-interval '30 seconds' then
     raise exception 'YouTube scheduling is still settling; retry shortly' using errcode='55000';
   end if;
   if coalesce((v_game.config->>'youtubeEnabled')::boolean,false) then
     new.session_key:=new.game_id;
     if v_game.youtube_scheduled_status in ('intent','ready') then
       new.youtube_broadcast_create_state:='intent';
       new.desired_state:='live';
       new.status:='preparing';
     end if;
   end if;
   if v_game.youtube_scheduled_status='ready' and v_game.youtube_scheduled_broadcast_id is not null then
     new.youtube_broadcast_id:=v_game.youtube_scheduled_broadcast_id;
     new.provider_session_id:=v_game.youtube_scheduled_broadcast_id;
     new.watch_url:=v_game.youtube_scheduled_watch_url;
     new.youtube_broadcast_create_state:='ready';
     new.youtube_channel_id:=v_game.youtube_scheduled_channel_id;
     new.youtube_connection_version:=v_game.youtube_scheduled_connection_version;
   end if;
 end if;
 return new;
end $$;

revoke all on function public.adopt_scheduled_youtube_broadcast() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
