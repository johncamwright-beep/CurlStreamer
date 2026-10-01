-- Restart the local sender, never replace or retire the game's watch page.
-- Old grants remain terminal. Only a new, authorized pairing may receive a new
-- one-use output intent once every prior sender's enforced lease has expired.
create function public.m4_output_recovery_safe(p_intent public.m4_output_intents)
returns boolean language sql volatile security definer set search_path='' as $$
  select public.m4_intent_is_retired(p_intent) or exists (
    select 1 from public.m4_desktop_sessions s
    where s.session_id=p_intent.session_id and s.game_id=p_intent.game_id
      and s.organization_id=p_intent.organization_id and s.generation=p_intent.generation
      and s.expires_at is not null and s.lease_expires_at is not null
      -- Retain the last issued deadline even after Stop/revocation. Status alone
      -- does not prove that a previously delivered target stopped sending.
      and least(s.expires_at,s.lease_expires_at)+interval '3 seconds'<clock_timestamp()
  )
$$;
revoke all on function public.m4_output_recovery_safe(public.m4_output_intents)
  from public,anon,authenticated,service_role;

-- Preserve deployed authorization, transaction locks, channel/version binding,
-- and one-use delivery checks. Fail closed if the expected guard is missing.
do $$
declare signature text; definition text; guard text:='not public.m4_intent_is_retired(i)';
begin
  foreach signature in array array[
    'public.trial_legacy_claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid)',
    'public.approve_m4_desktop_pairing(uuid,uuid,boolean,text,text)',
    'public.claim_m4_output_intent(uuid,uuid,bigint,text,uuid)',
    'public.mark_m4_output_delivery(uuid,uuid,bigint,text,uuid)',
    'public.m4_output_delivery_authority(uuid,uuid,bigint,text,uuid,boolean)'
  ] loop
    definition:=pg_get_functiondef(signature::regprocedure);
    if position(guard in definition)=0 then
      raise exception 'Expected output quarantine guard missing in %',signature;
    end if;
    definition:=replace(definition,guard,'not public.m4_output_recovery_safe(i)');
    if signature like 'public.trial_legacy_claim%' or signature like 'public.approve_m4_desktop%' then
      definition:=replace(definition,
        'raise exception ''output delivery quarantined'' using errcode=''55000''',
        'raise exception ''previous output lease has not expired'' using errcode=''P0409''');
    end if;
    if signature like 'public.trial_legacy_claim%' then
      -- Even an older client cannot race into a replacement of a saved link.
      definition:=replace(definition,
        'if v_b.status=''stopped'' and v_b.desired_state=''stopped'' then',
        'if v_b.status=''stopped'' and v_b.desired_state=''stopped'' and v_b.watch_url is not null then
          raise exception ''saved broadcast has ended'' using errcode=''55000'';
        end if;
        if v_b.status=''stopped'' and v_b.desired_state=''stopped'' then');
      if position('saved broadcast has ended' in definition)=0 then
        raise exception 'Expected saved watch guard missing';
      end if;
    end if;
    execute definition;
  end loop;
end $$;

-- Provider retirement and explicit replacement-cycle authority are unchanged.
notify pgrst,'reload schema';
