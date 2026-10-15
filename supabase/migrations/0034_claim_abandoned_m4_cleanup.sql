-- Claim cleanup only when no desktop can still be using this broadcast.
create function public.claim_abandoned_m4_cleanup(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_broadcast_transport(p_game_id,'local-obs');
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  perform 1 from public.m4_desktop_sessions where game_id=p_game_id order by session_id for update;
  if exists(select 1 from public.m4_desktop_sessions where game_id=p_game_id and
    (status='pending' and expires_at>clock_timestamp() or status='active' and expires_at>clock_timestamp() and lease_expires_at>clock_timestamp()))
    then raise exception 'Studio still owns this broadcast' using errcode='55000'; end if;
  if not exists(select 1 from public.m4_output_intents i where i.game_id=p_game_id
    and i.delivery_recorded_at is not null and not public.m4_intent_is_retired(i))
    then raise exception 'No abandoned delivery' using errcode='55000'; end if;
  return public.claim_m4_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,'stopped',p_operation_token);
end $$;
revoke all on function public.claim_abandoned_m4_cleanup(uuid,uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.claim_abandoned_m4_cleanup(uuid,uuid,boolean,uuid) to service_role;
notify pgrst, 'reload schema';
