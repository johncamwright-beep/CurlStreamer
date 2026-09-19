import { isCurrentGame, preferredGame } from "@/lib/current-game";
import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { requireCoachAccount } from "@/lib/curlcoach/production-access";
import { readTeamSettings } from "@/lib/providers/team-settings";
import { createHash } from "node:crypto";
import {
  listEvents,
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
/** Read-only integration. Revalidate account and event membership on every request. */
export async function loadProductionStreamerEvent(
  eventId?: string,
  gameId?: string,
) {
  const account = await requireCoachAccount();
  if (!account) throw new Error("Private coaching access is required.");
  const { data, error } = await (
    await createServerSupabaseClient()
  ).auth.getUser();
  if (error || !data.user || data.user.id !== account.userId)
    throw new Error("Sign in to your account first.");
  const { settings } = await readTeamSettings(account.organizationId);
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
  const [events, games] = await Promise.all([
    listEvents(data.user),
    listTeamHierarchyGames(data.user),
  ]);
  if (!events.ok || !games.ok)
    throw new Error("Team event data is unavailable.");
  const catalog = z
    .array(z.object({ id: z.string().uuid(), name: z.string() }))
    .parse(events.value);
  if (
    z
      .array(
        z.object({ event_id: z.string().nullable(), game_status: z.string() }),
      )
      .parse(games.value)
      .some((game) => game.event_id === null && game.game_status !== "deleted")
  )
    catalog.push({ id: "standalone", name: "Single games" });
  if (!catalog.length)
    catalog.push({ id: "no-games", name: "No scheduled games" });
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
  const selected = catalog.find(
    (event) => event.id === (eventId || defaultEvent),
  );
  if (!selected) throw new Error("Event unavailable for this organization.");
  const rows = z
    .array(
      z.object({
        id: z.string().uuid(),
        event_id: z.string().uuid().nullable(),
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
        game.event_id === (selected.id === "standalone" ? null : selected.id) &&
        game.game_status !== "deleted" &&
        (!gameId || game.id === gameId),
    );
  const event: CoachEvent = {
    id: selected.id,
    name: selected.name,
    source: "streamer",
    organizationId: account.organizationId,
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
      scheduledStart: row.scheduled_start,
      timezone: row.timezone,
      status: row.game_status,
      // The scheduling form stores the owning team in homeName.
      side: "home",
      initialHammer: row.config.initialHammer ?? null,
      scoreboardAvailable: available,
      ends: scoreboard(row.config as GameConfig, scoreEvents, "home"),
      state: {
        ...emptyState(),
        organizationId: event.organizationId,
        gameId: row.id,
        roster,
        revision: 0,
        status: "open",
      },
    });
  }
  return { event, catalog, actor: data.user.id };
}
