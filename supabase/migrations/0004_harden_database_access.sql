-- Application data is accessed only by the server with SUPABASE_SECRET_KEY.
-- RLS is deliberately enabled without client policies: browser roles must not
-- read or mutate these tables, even if a table grant is added accidentally.
alter table public.organizations enable row level security;
alter table public.organizer_users enable row level security;
alter table public.broadcast_settings enable row level security;
alter table public.games enable row level security;
alter table public.game_invitations enable row level security;
alter table public.camera_assignments enable row level security;
alter table public.score_events enable row level security;
alter table public.game_states enable row level security;
alter table public.broadcast_sessions enable row level security;
alter table public.health_events enable row level security;
alter table public.sponsor_assets enable row level security;
alter table public.sponsor_libraries enable row level security;
alter table public.game_sponsors enable row level security;
alter table public.sponsor_display_settings enable row level security;
alter table public.sponsor_display_sessions enable row level security;
alter table public.sponsor_audit_events enable row level security;

-- Remove Supabase's schema defaults as well as any grants made since the
-- initial migrations. Revoke service_role first, then restore only the direct
-- table operations currently used by the server store.
revoke all privileges on table
  public.organizations,
  public.organizer_users,
  public.broadcast_settings,
  public.games,
  public.game_invitations,
  public.camera_assignments,
  public.score_events,
  public.game_states,
  public.broadcast_sessions,
  public.health_events,
  public.sponsor_assets,
  public.sponsor_libraries,
  public.game_sponsors,
  public.sponsor_display_settings,
  public.sponsor_display_sessions,
  public.sponsor_audit_events
from public, anon, authenticated, service_role;

grant select, update on table public.game_states to service_role;

revoke all privileges on sequence
  public.score_events_sequence_seq,
  public.health_events_id_seq,
  public.sponsor_audit_events_id_seq
from public, anon, authenticated, service_role;

-- SECURITY DEFINER routines use fully-qualified object names and an empty
-- search path, preventing caller-controlled objects from being resolved.
alter function public.create_game(uuid, jsonb, jsonb)
  security definer;
alter function public.create_game(uuid, jsonb, jsonb)
  set search_path = '';
alter function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
  security definer;
alter function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
  set search_path = '';

revoke all privileges on function public.create_game(uuid, jsonb, jsonb)
  from public, anon, authenticated, service_role;
revoke all privileges on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.create_game(uuid, jsonb, jsonb)
  to service_role;
grant execute on function public.append_score_event(uuid, bigint, uuid, text, jsonb, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
