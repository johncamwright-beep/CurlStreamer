begin;

-- Codes are bearer invitations. Store only SHA-256 hashes; issuance is operator-only.
create table public.team_trial_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  redeemed_by_organization uuid references public.organizations(id),
  redeemed_by_user uuid,
  redeemed_at timestamptz,
  check ((redeemed_at is null) = (redeemed_by_organization is null))
);
create table public.team_access (
  organization_id uuid primary key references public.organizations(id),
  trial_code_id uuid unique references public.team_trial_codes(id),
  trial_expires_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.team_trial_codes enable row level security;
alter table public.team_access enable row level security;
revoke all on public.team_trial_codes, public.team_access from public, anon, authenticated;
grant all on public.team_trial_codes, public.team_access to service_role;

-- Existing pilot teams keep access through the current calendar year.
insert into public.team_access(organization_id,trial_expires_at)
select id, date_trunc('year',now() at time zone 'America/Toronto') + interval '1 year'
  at time zone 'America/Toronto' from public.organizations;

create function public.assert_team_broadcast_access(p_org uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.team_access where organization_id=p_org and trial_expires_at>now()) then
    raise exception 'trial or subscription required' using errcode='P0402';
  end if;
end $$;
revoke all on function public.assert_team_broadcast_access(uuid) from public,anon,authenticated;
grant execute on function public.assert_team_broadcast_access(uuid) to service_role;

-- Preserve the existing authority and cleanup logic; gate only new starts.
alter function public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) rename to trial_legacy_claim_m4_broadcast_operation;
revoke all on function public.trial_legacy_claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
create function public.claim_m4_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if p_desired_state='prepared' then
    perform public.assert_team_broadcast_access((select organization_id from public.games where id=p_game_id));
  end if;
  return public.trial_legacy_claim_m4_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,p_desired_state,p_operation_token);
end $$;
revoke all on function public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_m4_broadcast_operation(uuid,uuid,boolean,text,uuid) to service_role;

alter function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) rename to trial_legacy_claim_game_broadcast_operation;
revoke all on function public.trial_legacy_claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated,service_role;
create function public.claim_game_broadcast_operation(p_game_id uuid,p_actor_user_id uuid,p_verified_organizer boolean,p_desired_state text,p_operation_token uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform 1 from public.authorize_game_broadcast_actor(p_game_id,p_actor_user_id,coalesce(p_verified_organizer,false));
  if p_desired_state='live' then
    perform public.assert_team_broadcast_access((select organization_id from public.games where id=p_game_id));
  end if;
  return public.trial_legacy_claim_game_broadcast_operation(p_game_id,p_actor_user_id,p_verified_organizer,p_desired_state,p_operation_token);
end $$;
revoke all on function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) from public,anon,authenticated;
grant execute on function public.claim_game_broadcast_operation(uuid,uuid,boolean,text,uuid) to service_role;

create function public.redeem_team_trial(p_user_id uuid, p_code_hash text)
returns timestamptz language plpgsql security definer set search_path='' as $$
declare
  v_org uuid := public.verified_team_for_operation(p_user_id, true);
  v_code public.team_trial_codes%rowtype;
  v_access public.team_access%rowtype;
begin
  -- Serialize all redemptions for this organization, including different codes.
  perform 1 from public.organizations where id=v_org for update;
  select * into v_code from public.team_trial_codes where code_hash=p_code_hash for update;
  if not found or v_code.revoked_at is not null or v_code.expires_at<=now() then
    raise exception 'invalid trial code' using errcode='22023';
  end if;
  if v_code.redeemed_by_organization is not null and v_code.redeemed_by_organization<>v_org then
    raise exception 'invalid trial code' using errcode='22023';
  end if;
  select * into v_access from public.team_access where organization_id=v_org;
  if v_access.trial_code_id=v_code.id then return v_access.trial_expires_at; end if;
  if v_access.trial_code_id is not null then
    raise exception 'team already redeemed a trial' using errcode='23514';
  end if;
  insert into public.team_access(organization_id,trial_code_id,trial_expires_at)
    values(v_org,v_code.id,v_code.expires_at)
    on conflict(organization_id) do update set trial_code_id=excluded.trial_code_id,
      trial_expires_at=excluded.trial_expires_at,updated_at=now();
  update public.team_trial_codes set redeemed_by_organization=v_org,
    redeemed_by_user=p_user_id,redeemed_at=now() where id=v_code.id;
  insert into public.audit_events(actor_user_id,organization_id,action,subject_type,subject_identifier,metadata)
    values(p_user_id,v_org,'trial.redeemed','trial',v_code.id::text,jsonb_build_object('expires_at',v_code.expires_at));
  return v_code.expires_at;
end $$;
revoke all on function public.redeem_team_trial(uuid,text) from public,anon,authenticated;
grant execute on function public.redeem_team_trial(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
