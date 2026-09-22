import { readGameCompletionSummary } from "@/lib/game-completion";
import { loadCoachBroadcastReviews } from "./curlcoach-video";
import { isCurrentGame, preferredGame } from "@/lib/current-game";
import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  requireCoachAccount,
  type CoachAccount,
} from "@/lib/curlcoach/production-access";
import { readTeamSettings } from "@/lib/providers/team-settings";
import { createHash } from "node:crypto";
import {
  listEvents,
  listSeasons,
  listTeamHierarchyGames,
} from "@/lib/team-hierarchy-service";
import { emptyState } from "@/lib/curlcoach/model";
import { scoreboard, type CoachEvent } from "@/lib/curlcoach/event";
import type { GameConfig, ScoreEvent } from "@/lib/types";

const endSchema = z.object({
  end: z.number().int().positive(),
  team: z.enum(["home", "away"]).nullable(),
  points: z.number().int().min(0).max(8),
  blank: z.boolean(),
});
const MAX_CONCURRENT_SCORE_READS = 4;

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next++;
      results[index] = await mapper(values[index]!, index);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );
  return results;
}
/** Read-only integration. Revalidate account and event membership on every request. */
export async function loadProductionStreamerEvent(
  eventId?: string,
  gameId?: string,
  seasonId?: string,
  requestAccount?: CoachAccount,
) {
  // The route may pass an account it just authorized. Direct callers establish
  // the same request-local scope here; this is never cached across requests.
  const account = requestAccount ?? (await requireCoachAccount());
  if (!account) throw new Error("Private coaching access is required.");
  const settingsResult = readTeamSettings(account.organizationId);
  const hierarchyResult = Promise.all([
    listEvents(account.user),
    listTeamHierarchyGames(account.user),
    listSeasons(account.user),
  ]);
  const [{ settings }, [events, games, seasonResult]] = await Promise.all([
    settingsResult,
    hierarchyResult,
  ]);
  // Snapshot the existing team roster. Never substitute the lab's example players.
  const roster = (["lead", "second", "third", "fourth"] as const)
    .filter((position) => settings.roster[position].trim())
    .map((position) => ({
      id: createHash("sha256")
        .update(
          `${account.organizationId}:${position}:${settings.roster[position].trim()}`,
        )
        .digest("hex"),
      name: settings.roster[position].trim(),
      position: (position[0].toUpperCase() + position.slice(1)) as
        "Lead" | "Second" | "Third" | "Fourth",
    }));
  if (!events.ok || !games.ok || !seasonResult.ok)
    throw new Error("Team event data is unavailable.");
  const seasons = z
    .array(z.object({ id: z.string().uuid(), name: z.string() }))
    .parse(seasonResult.value);
  const catalog = z
    .array(
      z.object({
        id: z.string().uuid(),
        name: z.string(),
        season_id: z.string().uuid().nullable().optional(),
      }),
    )
    .parse(events.value)
    .map(({ season_id, ...event }) => ({
      ...event,
      seasonId: season_id ?? "unassigned",
    }));
  if (
    z
      .array(
        z.object({ event_id: z.string().nullable(), game_status: z.string() }),
      )
      .parse(games.value)
      .some((game) => game.event_id === null && game.game_status !== "deleted")
  )
    catalog.push({
      id: "standalone",
      name: "Single games",
      seasonId: "unassigned",
    });
  if (!catalog.length)
    catalog.push({
      id: "no-games",
      name: "No scheduled games",
      seasonId: "unassigned",
    });
  seasons.push({ id: "unassigned", name: "No season assigned" });
  if (seasonId && !seasons.some((season) => season.id === seasonId))
    throw new Error("Season unavailable for this organization.");
  const candidates = z
    .array(
      z.object({
        id: z.string(),
        event_id: z.string().nullable(),
        game_status: z.string(),
        scheduled_start: z.string().nullable().optional(),
        timezone: z.string().nullable().optional(),
      }),
    )
    .parse(games.value)
    .filter((g) => g.game_status !== "deleted")
    .map((g) => ({
      ...g,
      scheduledStart: g.scheduled_start,
      status: g.game_status,
    }));
  const recommended = preferredGame(candidates);
  const eventDates = z
    .array(
      z.object({
        id: z.string(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        timezone: z.string().optional(),
        archived_at: z.string().nullable().optional(),
      }),
    )
    .parse(events.value);
  const currentEvent = eventDates.find((e) => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: e.timezone ?? "America/Toronto",
    }).format(new Date());
    return (
      !e.archived_at &&
      e.start_date &&
      e.end_date &&
      e.start_date <= today &&
      e.end_date >= today
    );
  });
  const defaultEvent =
    recommended &&
    isCurrentGame(
      recommended.scheduledStart,
      recommended.timezone ?? "America/Toronto",
    )
      ? (recommended.event_id ?? "standalone")
      : (currentEvent?.id ??
        (recommended
          ? (recommended.event_id ?? "standalone")
          : catalog[0]?.id));
  const selected = seasonId
    ? { id: "all", name: "All events", seasonId }
    : catalog.find((event) => event.id === (eventId || defaultEvent));
  if (!selected) throw new Error("Event unavailable for this organization.");
  const rows = z
    .array(
      z.object({
        id: z.string().uuid(),
        event_id: z.string().uuid().nullable(),
        season_id: z.string().uuid().nullable().optional(),
        scheduled_start: z.string().nullable().optional(),
        timezone: z.string().nullable().optional(),
        game_number: z.number().nullable(),
        game_label: z.string().nullable(),
        game_status: z.string(),
        config: z.object({
          eventName: z.string(),
          homeName: z.string(),
          awayName: z.string(),
          scheduledEnds: z.union([z.literal(8), z.literal(10)]),
          initialHammer: z.enum(["home", "away"]).optional(),
        }),
        completion_result: z
          .object({ ends: z.array(endSchema), outcome: z.string().optional() })
          .nullable()
          .optional(),
      }),
    )
    .parse(games.value)
    .filter(
      (game) =>
        (seasonId
          ? (game.season_id ??
              catalog.find((event) => event.id === game.event_id)?.seasonId ??
              "unassigned") === seasonId
          : game.event_id ===
            (selected.id === "standalone" ? null : selected.id)) &&
        game.game_status !== "deleted" &&
        (!gameId || game.id === gameId),
    );
  const event: CoachEvent = {
    id: selected.id,
    name: selected.name,
    source: "streamer",
    organizationId: account.organizationId,
    seasonId: selected.seasonId,
    games: [],
  };
  const broadcastReviews = gameId
    ? Promise.resolve<Awaited<ReturnType<typeof loadCoachBroadcastReviews>>>({})
    : loadCoachBroadcastReviews(
        account.organizationId,
        rows.map((row) => row.id),
      );
  event.games = await mapWithConcurrency(
    rows,
    MAX_CONCURRENT_SCORE_READS,
    async (row, index) => {
      const ends =
        row.completion_result?.outcome === "no_result"
          ? undefined
          : row.completion_result?.ends;
      let scoreEvents: ScoreEvent[] = [];
      let available = !!ends;
      if (ends)
        scoreEvents = ends.map((score, i) => ({
          id: String(i),
          at: 0,
          type: "end",
          score,
        }));
      else {
        // IDs come only from the account-scoped listing above, never the caller.
        const { data: snapshot, error: readError } =
          await createAdminSupabaseClient().rpc("read_game_state", {
            p_game_id: row.id,
          });
        // Completed games intentionally have no live state. Read their saved
        // line score rather than depending on the scheduling-list projection.
        if (
          !readError &&
          snapshot?.[0]?.outcome === "closed" &&
          row.completion_result?.outcome !== "no_result"
        ) {
          const completion = await readGameCompletionSummary(row.id);
          if (completion && completion.result.outcome !== "no_result") {
            const completedEnds = z
              .array(endSchema)
              .parse(completion.result.ends);
            scoreEvents = completedEnds.map((score, i) => ({
              id: String(i),
              at: 0,
              type: "end",
              score,
            }));
            available = completedEnds.length > 0;
          }
        }
        const state = snapshot?.[0]?.state;
        if (!readError && snapshot?.[0]?.outcome === "active" && state) {
          scoreEvents = z
            .array(
              z.discriminatedUnion("type", [
                z.object({
                  type: z.literal("end"),
                  id: z.string(),
                  at: z.number(),
                  score: endSchema,
                }),
                z.object({
                  type: z.literal("hammer"),
                  id: z.string(),
                  at: z.number(),
                  team: z.enum(["home", "away"]),
                }),
                z.object({
                  type: z.literal("undo"),
                  id: z.string(),
                  at: z.number(),
                  targetId: z.string(),
                }),
              ]),
            )
            .parse(state.scoreEvents);
          available = true;
        }
      }
      return {
        id: row.id,
        eventId: row.event_id ?? "standalone",
        label: row.game_label || `Game ${row.game_number ?? index + 1}`,
        teamName: row.config.homeName,
        opponent: row.config.awayName,
        scheduledEnds: row.config.scheduledEnds,
        scheduledStart: row.scheduled_start,
        timezone: row.timezone,
        status: row.game_status,
        // The scheduling form stores the owning team in homeName.
        side: "home",
        initialHammer: row.config.initialHammer ?? null,
        scoreboardAvailable: available,
        broadcastReview: (await broadcastReviews)[row.id],
        ends: scoreboard(row.config as GameConfig, scoreEvents, "home"),
        state: {
          ...emptyState(),
          organizationId: event.organizationId,
          gameId: row.id,
          roster,
          revision: 0,
          status: "open",
        },
      };
    },
  );
  return { event, catalog, seasons, actor: account.userId };
}
