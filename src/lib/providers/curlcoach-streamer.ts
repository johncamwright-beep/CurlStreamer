import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadActiveTeam } from "@/lib/team-games";
import {
  listEvents,
  listTeamHierarchyGames,
} from "@/lib/team-hierarchy-service";
import { emptyState } from "@/lib/curlcoach/model";
import { scoreboard, type CoachEvent } from "@/lib/curlcoach/event";
import type { GameConfig, ScoreEvent } from "@/lib/types";

export function localStreamerConfigured(
  url = process.env.NEXT_PUBLIC_SUPABASE_URL,
) {
  try {
    return (
      !!url &&
      ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname) &&
      ["http:", "https:"].includes(new URL(url).protocol) &&
      new URL(url).port !== "9"
    );
  } catch {
    return false;
  }
}
const endSchema = z.object({
  end: z.number().int().positive(),
  team: z.enum(["home", "away"]).nullable(),
  points: z.number().int().min(0).max(8),
  blank: z.boolean(),
});
/** Read-only integration. Revalidate account and event membership on every request. */
export async function loadStreamerEvent(eventId?: string) {
  if (!localStreamerConfigured())
    throw new Error(
      "Streamer is not connected. Configure a disposable local Supabase service and sign in as its team administrator. Shared services are disabled in this lab.",
    );
  const { data, error } = await (
    await createServerSupabaseClient()
  ).auth.getUser();
  if (error || !data.user)
    throw new Error("Sign in to the local Streamer account first.");
  const team = await loadActiveTeam(data.user);
  if (
    team.kind !== "ready" ||
    !["owner", "team_admin"].includes(team.team.role)
  )
    throw new Error(
      "A verified team administrator is required for Streamer coaching data.",
    );
  const [events, games] = await Promise.all([
    listEvents(data.user),
    listTeamHierarchyGames(data.user),
  ]);
  if (!events.ok || !games.ok)
    throw new Error("Local Streamer event data is unavailable.");
  const catalog = z
    .array(z.object({ id: z.string().uuid(), name: z.string() }))
    .parse(events.value);
  const selected = catalog.find(
    (event) => event.id === (eventId || catalog[0]?.id),
  );
  if (!selected) throw new Error("Event unavailable for this organization.");
  const rows = z
    .array(
      z.object({
        id: z.string().uuid(),
        event_id: z.string().uuid().nullable(),
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
      (game) => game.event_id === selected.id && game.game_status !== "deleted",
    );
  const event: CoachEvent = {
    id: selected.id,
    name: selected.name,
    source: "streamer",
    organizationId: team.team.organizationId,
    games: [],
  };
  for (const [index, row] of rows.entries()) {
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
    event.games.push({
      id: row.id,
      eventId: selected.id,
      label: row.game_label || `Game ${row.game_number ?? index + 1}`,
      teamName: row.config.homeName,
      opponent: row.config.awayName,
      scheduledEnds: row.config.scheduledEnds,
      status: row.game_status,
      side: "home",
      initialHammer: row.config.initialHammer ?? null,
      scoreboardAvailable: available,
      ends: scoreboard(row.config as GameConfig, scoreEvents, "home"),
      state: {
        ...emptyState(),
        organizationId: event.organizationId,
        gameId: row.id,
      },
    });
  }
  return { event, catalog, actor: data.user.id };
}
