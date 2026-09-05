-- Role claims remain in game_states, but every role now has an authorization
-- generation. A credential is valid only for the generation that assigned it.
-- Generationless credentials issued before this migration are accepted only
-- while their role remains at generation zero; an explicit release is the
-- bounded fail-closed transition for that role.
alter table public.game_invitations
  add column expected_generation bigint,
  add column consumed_at timestamptz,
  add column consumed_by_device_id uuid,
  add column assigned_generation bigint;

create index game_invitations_active_role_idx
  on public.game_invitations(game_id, role, expires_at)
  where revoked_at is null and consumed_at is null;

create function public.prepare_game_role_invitation(
  p_game_id uuid,
  p_role text,
  p_invitation_id uuid,
  p_expires_at timestamptz
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_generation bigint;
  v_db_role public.game_role;
begin
  if p_role not in ('camera-home', 'camera-away', 'scorer')
     or p_expires_at <= now() then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;
  v_db_role := replace(p_role, '-', '_')::public.game_role;

  select gs.state into v_state
  from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;

  perform 1 from public.games g
  where g.id = p_game_id and g.deleted_at is null and g.completed_at is null
  for update;
  if not found or v_state->>'status' <> 'active' then
    raise exception 'game_unavailable' using errcode = '55000';
  end if;
  if nullif(v_state#>>array['claims', p_role::text], '') is not null then
    raise exception 'participant_locked' using errcode = '23514';
  end if;

  v_generation := coalesce(
    (v_state#>>array['claimGenerations', p_role::text])::bigint,
    0
  ) + 1;
  update public.game_states gs
  set state = jsonb_set(
        jsonb_set(
          gs.state,
          '{claimGenerations}',
          coalesce(gs.state->'claimGenerations', '{}'::jsonb),
          true
        ),
        array['claimGenerations', p_role::text],
        to_jsonb(v_generation),
        true
      ),
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id;

  update public.game_invitations i
  set revoked_at = now()
  where i.game_id = p_game_id and i.role = v_db_role
    and i.revoked_at is null and i.consumed_at is null;

  insert into public.game_invitations(
    id, game_id, role, token_hash, expires_at, expected_generation
  ) values (
    p_invitation_id, p_game_id, v_db_role, p_invitation_id::text,
    p_expires_at, v_generation
  );
  return v_generation;
end;
$$;

create function public.claim_game_role(
  p_game_id uuid,
  p_role text,
  p_invitation_id uuid,
  p_expected_generation bigint,
  p_claimant uuid,
  p_expires_at timestamptz
)
returns table(game_state jsonb, assignment_generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_generation bigint;
  v_claim text;
  v_invitation record;
  v_db_role public.game_role;
begin
  if p_role not in ('camera-home', 'camera-away', 'scorer')
     or p_expires_at <= now() then
    raise exception 'invalid_invitation' using errcode = '22023';
  end if;
  v_db_role := replace(p_role, '-', '_')::public.game_role;

  select gs.state into v_state
  from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  perform 1 from public.games g
  where g.id = p_game_id and g.deleted_at is null and g.completed_at is null
  for update;
  if not found or v_state->>'status' <> 'active' then
    raise exception 'game_unavailable' using errcode = '55000';
  end if;

  v_generation := coalesce(
    (v_state#>>array['claimGenerations', p_role::text])::bigint,
    0
  );
  v_claim := nullif(v_state#>>array['claims', p_role::text], '');

  select i.* into v_invitation
  from public.game_invitations i
  where i.id = p_invitation_id
  for update;
  if not found then
    -- A cryptographically valid pre-0019 invitation has a jti but no durable
    -- row. Admit it only during generation zero and record its consumption so
    -- a response-loss retry by the same device stays idempotent.
    if p_expected_generation is not null or v_generation <> 0 then
      raise exception 'stale_invitation' using errcode = '55000';
    end if;
    insert into public.game_invitations(
      id, game_id, role, token_hash, expires_at, expected_generation
    ) values (
      p_invitation_id, p_game_id, v_db_role, p_invitation_id::text,
      p_expires_at, 0
    ) returning * into v_invitation;
  end if;

  if v_invitation.game_id <> p_game_id
     or v_invitation.role <> v_db_role
     or v_invitation.revoked_at is not null
     or v_invitation.expires_at <= now()
     or v_invitation.expected_generation <> v_generation
     or (p_expected_generation is not null
       and p_expected_generation <> v_invitation.expected_generation) then
    raise exception 'stale_invitation' using errcode = '55000';
  end if;

  if v_invitation.consumed_at is not null then
    if v_invitation.consumed_by_device_id = p_claimant
       and v_invitation.assigned_generation = v_generation
       and v_claim = p_claimant::text then
      return query select v_state, v_generation;
      return;
    end if;
    raise exception 'invitation_consumed' using errcode = '55000';
  end if;

  if v_claim is not null and v_claim <> p_claimant::text then
    raise exception 'participant_locked' using errcode = '23514';
  end if;
  if v_claim is null then
    v_state := jsonb_set(
      v_state,
      array['claims', p_role::text],
      to_jsonb(p_claimant::text),
      true
    );
    update public.game_states gs
    set state = v_state,
        version = greatest(
          gs.version + 1,
          (extract(epoch from clock_timestamp()) * 1000)::bigint
        ),
        updated_at = now()
    where gs.game_id = p_game_id;
  end if;

  update public.game_invitations i
  set consumed_at = now(),
      consumed_by_device_id = p_claimant,
      assigned_generation = v_generation
  where i.id = p_invitation_id;
  return query select v_state, v_generation;
end;
$$;

create function public.release_game_role(
  p_game_id uuid,
  p_role text,
  p_expected_claim text,
  p_expected_generation bigint
)
returns table(game_state jsonb, released boolean, released_generation bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state jsonb;
  v_claim text;
  v_generation bigint;
  v_db_role public.game_role;
begin
  if p_role not in ('camera-home', 'camera-away') then
    raise exception 'invalid_role' using errcode = '22023';
  end if;
  v_db_role := replace(p_role, '-', '_')::public.game_role;
  select gs.state into v_state
  from public.game_states gs where gs.game_id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;
  perform 1 from public.games g where g.id = p_game_id for update;
  if not found then raise exception 'game_unavailable' using errcode = '23503'; end if;

  v_claim := nullif(v_state#>>array['claims', p_role::text], '');
  v_generation := coalesce(
    (v_state#>>array['claimGenerations', p_role::text])::bigint,
    0
  );
  if v_claim is null then
    return query select v_state, false, v_generation;
    return;
  end if;
  if p_expected_generation is null
     or v_claim <> p_expected_claim
     or v_generation <> p_expected_generation then
    raise exception 'assignment_changed' using errcode = '40001';
  end if;

  v_state := jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            v_state,
            '{claimGenerations}',
            coalesce(v_state->'claimGenerations', '{}'::jsonb),
            true
          ),
          array['claims', p_role::text],
          'null'::jsonb,
          true
        ),
        array['connections', p_role::text], 'false'::jsonb, true
      ),
      array['cameraHealth', p_role::text], 'null'::jsonb, true
    ),
    array['claimGenerations', p_role::text],
    to_jsonb(v_generation + 1),
    true
  );
  v_state := v_state #- array['claims', p_role::text]
    #- array['cameraHealth', p_role::text];
  update public.game_states gs
  set state = v_state,
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id;
  update public.game_invitations i
  set revoked_at = now()
  where i.game_id = p_game_id and i.role = v_db_role
    and i.revoked_at is null and i.consumed_at is null;
  return query select v_state, true, v_generation;
end;
$$;

-- Consumed invitations are durable, non-secret evidence of every generated
-- camera identity that may have received a provider credential. Terminal
-- cleanup can therefore retry after state claims and the room were cleared.
create function public.list_game_camera_identity_generations(p_game_id uuid)
returns table(role text, generation bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select replace(i.role::text, '_', '-'), i.assigned_generation
  from public.game_invitations i
  where i.game_id = p_game_id
    and i.role in ('camera_home'::public.game_role, 'camera_away'::public.game_role)
    and i.assigned_generation is not null
    and i.assigned_generation > 0
  group by i.role, i.assigned_generation
  order by i.role, i.assigned_generation;
$$;

-- Preserve generations across previous-application whole-state writes. Legacy
-- generation-zero claims remain compatible; after release, an unregistered
-- claim cannot cross the explicit generation boundary.
create or replace function public.write_game_state(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
  v_current jsonb;
  v_next jsonb := p_state;
  v_generations jsonb;
  v_role text;
  v_old_claim text;
  v_new_claim text;
  v_generation bigint;
begin
  select gs.state into v_current
  from public.game_states gs
  where gs.game_id = p_game_id and gs.version = p_expected_version
  for update;
  if not found then
    if not exists (select 1 from public.game_states gs where gs.game_id = p_game_id) then
      raise exception 'game_unavailable' using errcode = '23503';
    end if;
    raise exception 'stale game state for %', p_game_id using errcode = '40001';
  end if;

  v_generations := coalesce(v_current->'claimGenerations', '{}'::jsonb);
  foreach v_role in array array['camera-home', 'camera-away', 'scorer'] loop
    v_old_claim := nullif(v_current#>>array['claims', v_role], '');
    v_new_claim := nullif(v_next#>>array['claims', v_role], '');
    v_generation := coalesce((v_generations->>v_role)::bigint, 0);
    if v_old_claim is null and v_new_claim is not null and v_generation <> 0 then
      raise exception 'claim_generation_required' using errcode = '55000';
    elsif v_old_claim is not null and v_new_claim is null then
      v_generations := jsonb_set(
        v_generations, array[v_role], to_jsonb(v_generation + 1), true
      );
      update public.game_invitations i set revoked_at = now()
      where i.game_id = p_game_id
        and i.role::text = replace(v_role, '-', '_')
        and i.revoked_at is null and i.consumed_at is null;
    elsif v_old_claim is distinct from v_new_claim
       and v_old_claim is not null and v_new_claim is not null then
      raise exception 'assignment_changed' using errcode = '55000';
    end if;
  end loop;
  v_next := jsonb_set(v_next, '{claimGenerations}', v_generations, true);

  update public.game_states gs
  set state = v_next,
      version = greatest(
        gs.version + 1,
        (extract(epoch from clock_timestamp()) * 1000)::bigint
      ),
      updated_at = now()
  where gs.game_id = p_game_id
  returning gs.version into v_version;
  return v_version;
end;
$$;

revoke all privileges on function
  public.prepare_game_role_invitation(uuid, text, uuid, timestamptz),
  public.claim_game_role(uuid, text, uuid, bigint, uuid, timestamptz),
  public.release_game_role(uuid, text, text, bigint),
  public.list_game_camera_identity_generations(uuid)
from public, anon, authenticated, service_role;
grant execute on function
  public.prepare_game_role_invitation(uuid, text, uuid, timestamptz),
  public.claim_game_role(uuid, text, uuid, bigint, uuid, timestamptz),
  public.release_game_role(uuid, text, text, bigint),
  public.list_game_camera_identity_generations(uuid)
to service_role;

notify pgrst, 'reload schema';
