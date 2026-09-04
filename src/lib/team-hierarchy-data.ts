import "server-only";
import type { User } from "@supabase/supabase-js";
import { getAccountContext } from "@/lib/auth/account";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { EventType, SeasonStatus } from "@/lib/team-hierarchy";
import type { GameConfig } from "@/lib/types";

export type SeasonRecord = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: SeasonStatus;
};
export type EventRecord = {
  id: string;
  seasonId: string;
  name: string;
  eventType: EventType;
  startDate: string;
  endDate: string;
  location: string | null;
  timezone: string;
  archivedAt: string | null;
};
export type ScheduledGameRecord = {
  id: string;
  seasonId: string | null;
  eventId: string | null;
  opponentId: string | null;
  scheduledStart: string | null;
  gameNumber: number | null;
  gameLabel: string | null;
  createdAt: string;
  status: string;
  config: GameConfig;
};

export async function loadTeamHierarchyData(user: User) {
  const context = await getAccountContext(user);
  if (!context.ok || !context.account.membership) return { ok: false as const };
  const { membership } = context.account;
  const db = createAdminSupabaseClient();
  const [seasons, events, games] = await Promise.all([
    db
      .from("seasons")
      .select("id,name,start_date,end_date,status")
      .eq("organization_id", membership.organization_id)
      .order("start_date", { ascending: false }),
    db
      .from("events")
      .select(
        "id,season_id,name,event_type,start_date,end_date,location,timezone,archived_at",
      )
      .eq("organization_id", membership.organization_id)
      .order("start_date"),
    db
      .from("games")
      .select(
        "id,season_id,event_id,opponent_id,scheduled_start,game_number,game_label,created_at,status,config,game_states(state)",
      )
      .eq("organization_id", membership.organization_id)
      .is("deleted_at", null)
      .order("scheduled_start", { ascending: true, nullsFirst: false }),
  ]);
  if (seasons.error || events.error || games.error) {
    console.error("Hierarchy view unavailable", {
      seasons: seasons.error?.code,
      events: events.error?.code,
      games: games.error?.code,
    });
    return { ok: false as const };
  }
  return {
    ok: true as const,
    teamName: membership.teamName,
    role: membership.role,
    seasons: (seasons.data ?? []).map((s) => ({
      id: s.id,
      name: s.name,
      startDate: s.start_date,
      endDate: s.end_date,
      status: s.status,
    })) as SeasonRecord[],
    events: (events.data ?? []).map((e) => ({
      id: e.id,
      seasonId: e.season_id,
      name: e.name,
      eventType: e.event_type,
      startDate: e.start_date,
      endDate: e.end_date,
      location: e.location,
      timezone: e.timezone,
      archivedAt: e.archived_at,
    })) as EventRecord[],
    games: (games.data ?? []).map((g) => {
      const joined = g.game_states as unknown as
        | { state?: { status?: string } }
        | { state?: { status?: string } }[]
        | null;
      const state = Array.isArray(joined) ? joined[0]?.state : joined?.state;
      return {
        id: g.id,
        seasonId: g.season_id,
        eventId: g.event_id,
        opponentId: g.opponent_id,
        scheduledStart: g.scheduled_start,
        gameNumber: g.game_number,
        gameLabel: g.game_label,
        createdAt: g.created_at,
        status: state?.status ?? g.status,
        config: g.config as unknown as GameConfig,
      };
    }) as ScheduledGameRecord[],
  };
}
