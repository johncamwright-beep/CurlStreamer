create extension if not exists pgcrypto;

create type game_role as enum ('camera_home', 'camera_away', 'scorer');

create table games (
  id uuid primary key,
  config jsonb not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table game_states (
  game_id uuid primary key references games on delete cascade,
  version bigint not null default 0 check (version >= 0),
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table game_invitations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games on delete cascade,
  role game_role not null,
  token_hash text not null unique check (length(token_hash) = 64),
  expires_at timestamptz not null,
  claimed_by uuid,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check ((claimed_by is null) = (claimed_at is null))
);

create table game_role_claims (
  game_id uuid not null references games on delete cascade,
  role game_role not null,
  claimant uuid not null,
  claimed_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (game_id, role)
);

create table participant_connections (
  game_id uuid not null references games on delete cascade,
  role game_role not null,
  claimant uuid,
  connected boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (game_id, role)
);

create table score_events (
  id uuid primary key,
  game_id uuid not null references games on delete cascade,
  sequence bigint generated always as identity,
  event_type text not null check (event_type in ('end', 'hammer', 'undo')),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (game_id, sequence)
);

create index game_invitations_active_idx
  on game_invitations (game_id, role, expires_at)
  where claimed_at is null and revoked_at is null;
create index score_events_game_sequence_idx
  on score_events (game_id, sequence);
create index participant_connections_connected_idx
  on participant_connections (game_id)
  where connected;

alter table games enable row level security;
alter table game_states enable row level security;
alter table game_invitations enable row level security;
alter table game_role_claims enable row level security;
alter table participant_connections enable row level security;
alter table score_events enable row level security;

-- No browser policy is intentionally granted. Only the server-side secret role
-- can access this milestone's data until organizer authentication is added.
create policy "server only games" on games for all to service_role using (true) with check (true);
create policy "server only game states" on game_states for all to service_role using (true) with check (true);
create policy "server only invitations" on game_invitations for all to service_role using (true) with check (true);
create policy "server only claims" on game_role_claims for all to service_role using (true) with check (true);
create policy "server only connections" on participant_connections for all to service_role using (true) with check (true);
create policy "server only score events" on score_events for all to service_role using (true) with check (true);

create function create_curlcast_game(p_game_id uuid, p_config jsonb, p_state jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  insert into games (id, config, status) values (p_game_id, p_config, 'active');
  insert into game_states (game_id, state) values (p_game_id, p_state);
  insert into participant_connections (game_id, role)
    values (p_game_id, 'camera_home'), (p_game_id, 'camera_away'), (p_game_id, 'scorer');
end;
$$;

create function claim_game_role(
  p_game_id uuid,
  p_role game_role,
  p_claimant uuid,
  p_token_hash text
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  invitation game_invitations%rowtype;
  existing game_role_claims%rowtype;
  result jsonb;
  json_role text := replace(p_role::text, '_', '-');
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'This game is closed or unavailable.'; end if;

  select * into invitation from game_invitations
    where game_id = p_game_id and role = p_role and token_hash = p_token_hash
    for update;
  if not found or invitation.expires_at <= now() or invitation.revoked_at is not null then
    raise exception 'This link is invalid or expired.';
  end if;
  if invitation.claimed_by is not null and invitation.claimed_by <> p_claimant then
    raise exception 'This invitation has already been used.';
  end if;

  select * into existing from game_role_claims
    where game_id = p_game_id and role = p_role for update;
  if found and existing.revoked_at is null and existing.claimant <> p_claimant then
    raise exception 'This role is already in use.';
  end if;

  update game_invitations set claimed_by = p_claimant, claimed_at = coalesce(claimed_at, now())
    where id = invitation.id;
  insert into game_role_claims (game_id, role, claimant)
    values (p_game_id, p_role, p_claimant)
    on conflict (game_id, role) do update
      set claimant = excluded.claimant, claimed_at = now(), revoked_at = null;
  update participant_connections set claimant = p_claimant, updated_at = now()
    where game_id = p_game_id and role = p_role;
  update game_states
    set state = jsonb_set(state, array['claims', json_role], to_jsonb(p_claimant::text), true),
        version = version + 1, updated_at = now()
    where game_id = p_game_id returning state into result;
  return result;
end;
$$;

create function update_curlcast_game(
  p_game_id uuid,
  p_expected_version bigint,
  p_state jsonb,
  p_status text,
  p_connection_role game_role default null,
  p_connected boolean default null,
  p_event_id uuid default null,
  p_event_type text default null,
  p_event_payload jsonb default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare result jsonb;
begin
  perform 1 from games where id = p_game_id and status = 'active' for update;
  if not found then raise exception 'This game is closed or unavailable.'; end if;

  update game_states set state = p_state, version = version + 1, updated_at = now()
    where game_id = p_game_id and version = p_expected_version returning state into result;
  if not found then
    raise exception using errcode = '40001', message = 'Concurrent game update';
  end if;

  if p_event_id is not null then
    insert into score_events (id, game_id, event_type, payload)
      values (p_event_id, p_game_id, p_event_type, p_event_payload);
  end if;
  if p_connection_role is not null then
    update participant_connections set connected = p_connected, updated_at = now()
      where game_id = p_game_id and role = p_connection_role;
  end if;
  if p_status = 'closed' then
    update games set status = 'closed', closed_at = now() where id = p_game_id;
    update game_invitations set revoked_at = now()
      where game_id = p_game_id and revoked_at is null;
    update game_role_claims set revoked_at = now()
      where game_id = p_game_id and revoked_at is null;
    update participant_connections set connected = false, updated_at = now()
      where game_id = p_game_id;
  end if;
  return result;
end;
$$;

revoke all on all tables in schema public from anon, authenticated;
revoke execute on function create_curlcast_game(uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function claim_game_role(uuid, game_role, uuid, text) from public, anon, authenticated;
revoke execute on function update_curlcast_game(uuid, bigint, jsonb, text, game_role, boolean, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function create_curlcast_game(uuid, jsonb, jsonb) to service_role;
grant execute on function claim_game_role(uuid, game_role, uuid, text) to service_role;
grant execute on function update_curlcast_game(uuid, bigint, jsonb, text, game_role, boolean, uuid, text, jsonb) to service_role;
