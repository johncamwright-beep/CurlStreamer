import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  archiveEvent,
  archiveOpponent,
  archiveSeason,
  createEvent,
  createScheduledTeamGame,
  createSeason,
  findOrCreateOpponent,
  restoreOpponent,
  setCurrentSeason,
  updateEvent,
  listOpponents,
  updateScheduledTeamGame,
} from "@/lib/team-hierarchy-service";
import {
  eventInputSchema,
  localDateTimeToUtc,
  opponentInputSchema,
  seasonInputSchema,
} from "@/lib/team-hierarchy";
import { gameSchema } from "@/lib/schema";
import { initialGameState } from "@/lib/team-games";
import { loadTeamHierarchyData } from "@/lib/team-hierarchy-data";

const id = z.uuid();
const requestSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("createSeason"), input: seasonInputSchema }),
  z.object({ operation: z.literal("activateSeason"), seasonId: id }),
  z.object({ operation: z.literal("archiveSeason"), seasonId: id }),
  z.object({ operation: z.literal("createEvent"), input: eventInputSchema }),
  z.object({
    operation: z.literal("updateEvent"),
    eventId: id,
    input: eventInputSchema,
  }),
  z.object({ operation: z.literal("archiveEvent"), eventId: id }),
  z.object({
    operation: z.literal("createOpponent"),
    input: opponentInputSchema,
  }),
  z.object({
    operation: z.enum(["archiveOpponent", "restoreOpponent"]),
    opponentId: id,
  }),
  z
    .object({
      operation: z.enum(["createGame", "updateGame"]),
      gameId: id.optional(),
      seasonId: id,
      eventId: id.nullable(),
      opponentId: id.optional(),
      opponentName: z.string().trim().min(1).max(100).optional(),
      scheduledDate: z.iso.date(),
      scheduledTime: z.string().regex(/^\d{2}:\d{2}$/),
      timezone: z.string().min(1).max(100),
      gameNumber: z.number().int().positive().nullable(),
      config: gameSchema,
    })
    .refine(
      (value) =>
        !(value.opponentId && value.opponentName) &&
        (value.operation === "createGame" || Boolean(value.gameId)),
      {
        message: "Select an opponent or add a new one.",
      },
    ),
]);

const messages = {
  authorization: [403, "You do not have permission to make this change."],
  validation: [400, "Check the entered details and try again."],
  conflict: [409, "That change conflicts with existing team data."],
  service: [503, "The team schedule is temporarily unavailable."],
} as const;

export async function POST(request: Request) {
  const auth = await createServerSupabaseClient()
    .then((client) => client.auth.getUser())
    .catch(() => null);
  const user = auth?.data.user;
  if (!user?.email_confirmed_at)
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401 },
    );
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Check the entered details.", issues: parsed.error.flatten() },
      { status: 400 },
    );
  const body = parsed.data;
  let result;
  switch (body.operation) {
    case "createSeason":
      result = await createSeason(user, body.input);
      break;
    case "activateSeason":
      result = await setCurrentSeason(user, body.seasonId);
      break;
    case "archiveSeason":
      result = await archiveSeason(user, body.seasonId);
      break;
    case "createEvent":
      result = await createEvent(user, body.input);
      break;
    case "updateEvent":
      result = await updateEvent(user, body.eventId, body.input);
      break;
    case "archiveEvent":
      result = await archiveEvent(user, body.eventId);
      break;
    case "createOpponent":
      result = await findOrCreateOpponent(user, body.input);
      break;
    case "archiveOpponent":
      result = await archiveOpponent(user, body.opponentId);
      break;
    case "restoreOpponent":
      result = await restoreOpponent(user, body.opponentId);
      break;
    case "createGame":
    case "updateGame": {
      const hierarchy = await loadTeamHierarchyData(user);
      if (!hierarchy.ok) return hierarchyFailure({ kind: "service" });
      const selectedSeason = hierarchy.seasons.find(
        (season) => season.id === body.seasonId && season.status !== "archived",
      );
      const selectedEvent = body.eventId
        ? hierarchy.events.find(
            (event) =>
              event.id === body.eventId &&
              !event.archivedAt &&
              hierarchy.seasons.some(
                (season) =>
                  season.id === event.seasonId && season.status !== "archived",
              ),
          )
        : undefined;
      if (
        !selectedSeason ||
        (body.eventId &&
          (!selectedEvent || selectedEvent.seasonId !== body.seasonId))
      )
        return hierarchyFailure({ kind: "authorization" });
      const scheduledStart = localDateTimeToUtc(
        body.scheduledDate,
        body.scheduledTime,
        selectedEvent?.timezone ?? body.timezone,
      );
      if (!scheduledStart)
        return NextResponse.json(
          {
            error: "Choose a valid local date and time for the event timezone.",
          },
          { status: 400 },
        );
      let opponentId = body.opponentId;
      let opponentName = body.opponentName;
      if (!opponentId && body.opponentName) {
        const opponent = await findOrCreateOpponent(user, {
          displayName: body.opponentName!,
        });
        if (!opponent.ok) return hierarchyFailure(opponent);
        opponentId = (opponent.value as { opponent_id: string }[])[0]
          ?.opponent_id;
        opponentName = (opponent.value as { display_name: string }[])[0]
          ?.display_name;
      } else if (opponentId) {
        const opponents = await listOpponents(user);
        if (!opponents.ok) return hierarchyFailure(opponents);
        const selected = (
          opponents.value as { id: string; display_name: string }[]
        ).find((opponent) => opponent.id === opponentId);
        if (!selected) return hierarchyFailure({ kind: "authorization" });
        opponentName = selected.display_name;
      }
      if (body.operation === "updateGame") {
        const existing = hierarchy.games.find(
          (game) => game.id === body.gameId,
        );
        if (!existing) return hierarchyFailure({ kind: "authorization" });
        const snapshotConfig = {
          ...existing.config,
          eventName:
            existing.eventId === body.eventId
              ? existing.config.eventName
              : (selectedEvent?.name ?? "Single Game"),
          homeName: existing.config.homeName,
          awayName:
            existing.opponentId === (opponentId ?? null)
              ? existing.config.awayName
              : (opponentName ?? "Opponent TBD"),
        };
        result = await updateScheduledTeamGame(
          user,
          body.gameId!,
          {
            seasonId: body.seasonId,
            eventId: body.eventId,
            opponentId: opponentId ?? null,
            scheduledStart,
            timezone: selectedEvent?.timezone ?? body.timezone,
            gameNumber: body.eventId ? body.gameNumber : null,
          },
          snapshotConfig,
        );
        break;
      }
      const gameId = randomUUID();
      const config = {
        ...body.config,
        eventName: selectedEvent?.name ?? "Single Game",
        homeName: hierarchy.teamName,
        awayName: opponentName ?? "Opponent TBD",
      };
      const state = initialGameState(gameId, config);
      result = await createScheduledTeamGame(
        user,
        {
          seasonId: body.seasonId,
          eventId: body.eventId,
          opponentId: opponentId ?? null,
          scheduledStart,
          timezone: selectedEvent?.timezone ?? body.timezone,
          gameNumber: body.eventId ? body.gameNumber : null,
        },
        config,
        state,
      );
      break;
    }
  }
  if (!result.ok) return hierarchyFailure(result);
  return NextResponse.json(result.value ?? {}, {
    status: body.operation.startsWith("create") ? 201 : 200,
  });
}

function hierarchyFailure(result: { kind: keyof typeof messages }) {
  const [status, error] = messages[result.kind];
  return NextResponse.json({ error }, { status });
}
