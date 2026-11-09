begin;

-- Existing interest remains visible without unexpectedly emailing the backlog.
alter table public.pilot_waitlist
  add column notification_status text not null default 'not_requested'
    check (notification_status in ('not_requested','pending','sending','accepted','failed','unknown')),
  add column notification_attempt_id uuid,
  add column notification_attempted_at timestamptz,
  add column notification_sent_at timestamptz;
alter table public.pilot_waitlist alter column notification_status set default 'pending';

create function public.claim_waitlist_notification(p_email text)
returns setof public.pilot_waitlist
language sql security definer set search_path='' as $$
  update public.pilot_waitlist set notification_status='sending',
    notification_attempt_id=gen_random_uuid(), notification_attempted_at=now()
  where email=p_email and notification_status in ('pending','failed')
  returning *;
$$;

create function public.finish_waitlist_notification(p_id uuid,p_attempt uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_status not in ('accepted','failed','unknown') then raise exception 'Invalid notification status'; end if;
  update public.pilot_waitlist set notification_status=p_status,
    notification_sent_at=case when p_status='accepted' then now() else null end
  where id=p_id and notification_attempt_id=p_attempt and notification_status='sending';
end;
$$;
revoke all on function public.claim_waitlist_notification(text), public.finish_waitlist_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_waitlist_notification(text), public.finish_waitlist_notification(uuid,uuid,text) to service_role;
commit;
