import "server-only";
import type { User } from "@supabase/supabase-js";
import { getAccountContext } from "@/lib/auth/account";
import {
  listEvents,
  listSeasons,
  listTeamHierarchyGames,
} from "@/lib/team-hierarchy-service";
import type { EventType, SeasonStatus } from "@/lib/team-hierarchy";
import type { GameConfig } from "@/lib/types";
import type { CompletionResult } from "@/lib/game-completion";

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
  timezone: string | null;
  gameNumber: number | null;
  gameLabel: string | null;
  createdAt: string;
  status: string;
  config: GameConfig;
  completionResult?: CompletionResult | null;
  youtubeWatchUrl?: string | null;
};

export async function loadTeamHierarchyData(user: User) {
  const context = await getAccountContext(user);
  if (!context.ok || !context.account.membership) return { ok: false as const };
  const { membership } = context.account;
  const [seasons, events, games] = await Promise.all([
    listSeasons(user),
    listEvents(user),
    listTeamHierarchyGames(user),
  ]);
  if (!seasons.ok || !events.ok || !games.ok) {
    console.error("Hierarchy view unavailable", {
      seasons: seasons.ok ? undefined : seasons.kind,
      events: events.ok ? undefined : events.kind,
      games: games.ok ? undefined : games.kind,
    });
    return { ok: false as const };
  }
  return {
    ok: true as const,
    teamName: membership.teamName,
    role: membership.role,
    seasons: seasons.value.map((value) => {
      const s = value as Record<string, string>;
      return {
        id: s.id,
        name: s.name,
        startDate: s.start_date,
        endDate: s.end_date,
        status: s.status,
      };
    }) as SeasonRecord[],
    events: events.value.map((value) => {
      const e = value as Record<string, string | null>;
      return {
        id: e.id,
        seasonId: e.season_id,
        name: e.name,
        eventType: e.event_type,
        startDate: e.start_date,
        endDate: e.end_date,
        location: e.location,
        timezone: e.timezone,
        archivedAt: e.archived_at,
      };
    }) as EventRecord[],
    games: games.value.map((value) => {
      const g = value as Record<string, unknown>;
      return {
        id: g.id as string,
        seasonId: g.season_id as string | null,
        eventId: g.event_id as string | null,
        opponentId: g.opponent_id as string | null,
        scheduledStart: g.scheduled_start as string | null,
        timezone: g.schedule_timezone as string | null,
        gameNumber: g.game_number as number | null,
        gameLabel: g.game_label as string | null,
        createdAt: g.created_at as string,
        status: g.game_status as string,
        config: g.config as unknown as GameConfig,
        completionResult:
          (g.completion_result as CompletionResult | null) ?? null,
        youtubeWatchUrl: (g.youtube_watch_url as string | null) ?? null,
      };
    }) as ScheduledGameRecord[],
  };
}
