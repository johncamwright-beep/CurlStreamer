-- A provider URL is authoritative only after the session durably reached live.
-- Preparation may create and later delete a YouTube broadcast while retaining
-- its diagnostic watch URL in the session row.
create or replace function public.copy_review_watch_url_to_completion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select case
    when s.started_at is not null then coalesce(s.watch_url, r.youtube_watch_url)
    else r.youtube_watch_url
  end into new.youtube_watch_url
  from public.game_completion_reviews r
  left join public.broadcast_sessions s
    on s.game_id = r.game_id and s.provider = 'youtube'
  where r.id = new.review_id;
  return new;
end $$;

notify pgrst, 'reload schema';
