import { formatEventGameLabel } from "@/lib/game-title";
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
  saveOpponentDetails,
  opponentDetailsInputSchema,
  opponentDetailsUpdateInputSchema,
  listOpponentSeasons,
  listSeasons,
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
import { getAccountContext } from "@/lib/auth/account";
import {
  provisionScheduledYouTubeBroadcast,
  refreshScheduledYouTubeThumbnail,
} from "@/lib/providers/scheduled-youtube";

const id = z.uuid();
const requestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("createOpponentDetails"),
    input: opponentDetailsInputSchema.refine(
      (value) => value.expectedRevision === 0,
    ),
  }),
  z.object({
    operation: z.literal("updateOpponentDetails"),
    opponentId: id,
    input: opponentDetailsUpdateInputSchema,
  }),
  z.object({ operation: z.literal("createSeason"), input: seasonInputSchema }),
  z.object({ operation: z.literal("activateSeason"), seasonId: id }),
  z.object({ operation: z.literal("archiveSeason"), seasonId: id }),
  z.object({ operation: z.literal("createEvent"), input: eventInputSchema }),
  z.object({
    operation: z.literal("updateEvent"),
    eventId: id,
    input: eventInputSchema,
  }),
  z.object({ operation: z.literal("retryYouTube"), gameId: id }),
  z
    .object({ operation: z.literal("refreshYouTubeThumbnail"), gameId: id })
    .strict(),
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
  gameNumberConflict: [
    409,
    "That game number is already used in this event. Choose another number or leave the optional game number blank.",
  ],
  opponentNameConflict: [
    409,
    "An opponent with that name already exists. Choose another name or edit the existing opponent.",
  ],
  service: [503, "The team schedule is temporarily unavailable."],
  youtubeVisibilityLocked: [
    409,
    "YouTube visibility is fixed once its watch page is reserved or Studio is prepared. Choose Public when creating your next game.",
  ],
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
  const account = await getAccountContext(user);
  if (!account.ok || !account.account.membership)
    return hierarchyFailure({ kind: "authorization" });
  if (
    body.operation === "refreshYouTubeThumbnail" &&
    !["owner", "team_admin"].includes(account.account.membership.role)
  )
    return hierarchyFailure({ kind: "authorization" });
  if (
    ["createOpponentDetails", "updateOpponentDetails"].includes(
      body.operation,
    ) &&
    !["owner", "team_admin"].includes(account.account.membership.role)
  )
    return hierarchyFailure({ kind: "authorization" });
  if (
    account.account.membership.role === "game_operator" &&
    !["createGame", "updateGame", "retryYouTube", "createOpponent"].includes(
      body.operation,
    )
  )
    return hierarchyFailure({ kind: "authorization" });
  let result;
  switch (body.operation) {
    case "createOpponentDetails":
      result = await saveOpponentDetails(user, body.input);
      break;
    case "updateOpponentDetails":
      result = await saveOpponentDetails(
        user,
        {
          displayName: body.input.displayName,
          seasonId: body.input.seasonId,
          level: body.input.level,
          roster: body.input.roster,
          expectedRevision: body.input.expectedRevision,
        },
        {
          opponentId: body.opponentId,
          expectedDisplayName: body.input.expectedDisplayName,
        },
      );
      break;
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
      const existingGame =
        body.operation === "updateGame"
          ? hierarchy.games.find((game) => game.id === body.gameId)
          : undefined;
      if (body.operation === "updateGame" && !existingGame)
        return hierarchyFailure({ kind: "authorization" });
      const effectiveTimezone = body.timezone;
      const scheduledStart = localDateTimeToUtc(
        body.scheduledDate,
        body.scheduledTime,
        effectiveTimezone,
        existingGame?.scheduledStart,
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
        const existing = existingGame!;
        const snapshotConfig = {
          ...existing.config,
          eventName: formatEventGameLabel(
            existing.eventId === body.eventId
              ? existing.config.eventName
              : (selectedEvent?.name ?? "Single Game"),
            body.eventId ? body.gameNumber : null,
          ),
          youtubeTitle: body.config.youtubeTitle,
          youtubeEnabled: body.config.youtubeEnabled,
          youtubeVisibility: body.config.youtubeVisibility,
          sharedYoutubeWatchUrl: body.config.sharedYoutubeWatchUrl,
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
            timezone: effectiveTimezone,
            gameNumber: body.eventId ? body.gameNumber : null,
          },
          snapshotConfig,
        );
        if (
          result.ok &&
          !["completed", "closed"].includes(existing.status) &&
          snapshotConfig.youtubeEnabled &&
          !snapshotConfig.sharedYoutubeWatchUrl &&
          existing.scheduledYouTubeWatchUrl
        ) {
          const youtube = await provisionScheduledYouTubeBroadcast(user, {
            gameId: existing.id,
            title: snapshotConfig.youtubeTitle,
            visibility: snapshotConfig.youtubeVisibility,
            scheduledStart,
            thumbnail: {
              homeName: snapshotConfig.homeName,
              awayName: snapshotConfig.awayName,
              eventName: snapshotConfig.eventName,
              scheduledStart,
              timezone: effectiveTimezone,
            },
          }).catch(() => ({ status: "pending", thumbnailStatus: "pending" }));
          result = {
            ...result,
            value: { youtube },
          };
        }
        break;
      }
      const gameId = body.gameId ?? randomUUID();
      const config = {
        ...body.config,
        eventName: formatEventGameLabel(
          selectedEvent?.name ?? "Single Game",
          body.eventId ? body.gameNumber : null,
        ),
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
          timezone: effectiveTimezone,
          gameNumber: body.eventId ? body.gameNumber : null,
        },
        config,
        state,
      );
      if (result.ok && config.youtubeEnabled && !config.sharedYoutubeWatchUrl) {
        const youtube = await provisionScheduledYouTubeBroadcast(user, {
          gameId,
          title: config.youtubeTitle,
          visibility: config.youtubeVisibility,
          scheduledStart,
          thumbnail: {
            homeName: config.homeName,
            awayName: config.awayName,
            eventName: config.eventName,
            scheduledStart,
            timezone: effectiveTimezone,
          },
        }).catch(() => ({
          status: "pending" as const,
          watchUrl: null,
          errorCode: "youtube_provider_unavailable",
        }));
        result = {
          ...result,
          value: { ...result.value, youtube },
        };
      }
      break;
    }
    case "refreshYouTubeThumbnail": {
      const hierarchy = await loadTeamHierarchyData(user);
      const game = hierarchy.ok
        ? hierarchy.games.find((candidate) => candidate.id === body.gameId)
        : undefined;
      if (!game)
        return hierarchyFailure({
          kind: hierarchy.ok ? "authorization" : "service",
        });
      // Only an app-owned reserved page may receive team artwork. Shared links
      // never authorize changes to somebody else's video.
      if (
        !game.config.youtubeEnabled ||
        game.config.sharedYoutubeWatchUrl ||
        !game.scheduledStart ||
        !game.scheduledYouTubeWatchUrl
      )
        return hierarchyFailure({ kind: "validation" });
      const videoId = new URL(game.scheduledYouTubeWatchUrl).searchParams.get(
        "v",
      );
      if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId))
        return hierarchyFailure({ kind: "validation" });
      try {
        await refreshScheduledYouTubeThumbnail(user, game.id, videoId, {
          homeName: game.config.homeName,
          awayName: game.config.awayName,
          eventName: game.config.eventName,
          scheduledStart: game.scheduledStart,
          timezone: game.timezone ?? "America/Toronto",
        });
      } catch {
        return NextResponse.json(
          {
            error:
              "The thumbnail could not be updated. Check the connected YouTube channel and try again. Your game and video link have not changed.",
          },
          { status: 503 },
        );
      }
      return NextResponse.json({ updated: true });
    }
    case "retryYouTube": {
      const hierarchy = await loadTeamHierarchyData(user);
      const game = hierarchy.ok
        ? hierarchy.games.find((candidate) => candidate.id === body.gameId)
        : undefined;
      if (!game)
        return hierarchyFailure({
          kind: hierarchy.ok ? "authorization" : "service",
        });
      if (!game.config.youtubeEnabled || !game.scheduledStart)
        return hierarchyFailure({ kind: "validation" });
      const youtube = await provisionScheduledYouTubeBroadcast(user, {
        gameId: game.id,
        title: game.config.youtubeTitle,
        visibility: game.config.youtubeVisibility,
        scheduledStart: game.scheduledStart,
        thumbnail: {
          homeName: game.config.homeName,
          awayName: game.config.awayName,
          eventName: game.config.eventName,
          scheduledStart: game.scheduledStart,
          timezone: game.timezone ?? "America/Toronto",
        },
      }).catch(() => ({
        status: "pending" as const,
        watchUrl: null,
        errorCode: "youtube_provider_unavailable",
      }));
      return NextResponse.json({ game: { id: game.id }, youtube });
    }
  }
  if (!result.ok) return hierarchyFailure(result);
  return NextResponse.json(result.value ?? {}, {
    status: body.operation.startsWith("create") ? 201 : 200,
  });
}

export async function GET(request: Request) {
  const auth = await createServerSupabaseClient()
    .then((client) => client.auth.getUser())
    .catch(() => null);
  const user = auth?.data.user;
  if (!user?.email_confirmed_at)
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401 },
    );
  const params = new URL(request.url).searchParams;
  const parsed = z
    .object({ opponentId: id, seasonId: id })
    .strict()
    .safeParse(Object.fromEntries(params));
  if (!parsed.success) return hierarchyFailure({ kind: "validation" });
  const account = await getAccountContext(user);
  if (!account.ok || !account.account.membership)
    return hierarchyFailure({ kind: "authorization" });
  const [opponents, seasons, profiles] = await Promise.all([
    listOpponents(user),
    listSeasons(user),
    listOpponentSeasons(user),
  ]);
  if (!opponents.ok) return hierarchyFailure(opponents);
  if (!seasons.ok) return hierarchyFailure(seasons);
  if (!profiles.ok) return hierarchyFailure(profiles);
  const opponent = (
    opponents.value as { id: string; display_name: string }[]
  ).find((row) => row.id === parsed.data.opponentId);
  const season = (seasons.value as { id: string; status: string }[]).find(
    (row) => row.id === parsed.data.seasonId && row.status !== "archived",
  );
  if (!opponent || !season) return hierarchyFailure({ kind: "authorization" });
  const profile =
    (profiles.value as { opponent_id: string; season_id: string }[]).find(
      (row) => row.opponent_id === opponent.id && row.season_id === season.id,
    ) ?? null;
  return NextResponse.json(
    {
      opponent: { id: opponent.id, displayName: opponent.display_name },
      profile,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

function hierarchyFailure(result: { kind: keyof typeof messages }) {
  const [status, error] = messages[result.kind];
  return NextResponse.json({ error }, { status });
}
