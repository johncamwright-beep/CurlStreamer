import { NextResponse } from "next/server";
import { z } from "zod";
import { readGame } from "@/lib/providers/game-read";
import { broadcastGame, joinGame } from "@/lib/game-projection";
import { actionSchema, hasSafeSponsorContent } from "@/lib/schema";
import { getGame, updateGame } from "@/lib/store";
import {
  authorizationError,
  authorizeGame,
  operatorRoles,
  participantAccessMatches,
  type GameAuthorization,
} from "@/lib/game-authorization";
import {
  gameBroadcastSponsors,
  gameLibrarySponsors,
} from "@/lib/providers/sponsor-library";
import { isGameStateConflictError } from "@/lib/game-state-conflict";
export const dynamic = "force-dynamic";
const readParams = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/) });
const readView = z.enum(["broadcast", "join"]).optional();

function gameResponse(body: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("cache-control", "no-store");
  headers.set("vary", "Cookie, Authorization");
  return NextResponse.json(body, { ...init, headers });
}

function readFailure(
  reason: Extract<GameAuthorization, { ok: false }>["reason"],
) {
  const failure = authorizationError({ ok: false, reason });
  return gameResponse(
    {
      error: failure.error,
      ...(reason === "released" ? { code: "camera_assignment_released" } : {}),
      ...(reason === "closed" ? { lifecycle: "closed" } : {}),
      ...(reason === "deleted" ? { lifecycle: "deleted" } : {}),
    },
    { status: failure.status },
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = readParams.safeParse(await params);
  const view = readView.safeParse(
    new URL(request.url).searchParams.get("view") ?? undefined,
  );
  if (!parsed.success || !view.success)
    return gameResponse({ error: "Invalid game request" }, { status: 400 });
  const { id } = parsed.data;
  let authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) =>
      access.purpose !== "invitation" || view.data === "join",
    allowCompletedAccount: true,
  });
  // A viewer account must not shadow a valid organizer or participant bearer.
  // Only after the primary account-or-token decision misses do we retain
  // same-team viewer identity for a possible safe completed projection below.
  if (!authorization.ok && authorization.reason === "unauthorized") {
    const viewer = await authorizeGame(request, id, {
      accountRoles: ["viewer"],
      tokenAllowed: () => false,
      allowCompletedAccount: true,
    });
    if (viewer.ok) authorization = viewer;
  }
  const publicBroadcast =
    !authorization.ok &&
    authorization.reason === "unauthorized" &&
    authorization.anonymous &&
    view.data === "broadcast";
  if (
    !authorization.ok &&
    !publicBroadcast &&
    authorization.reason !== "closed"
  )
    return readFailure(authorization.reason);

  try {
    const result = await readGame(id);
    if (result.kind === "completed")
      return gameResponse(result.completion, {
        headers:
          authorization.ok && authorization.via === "account"
            ? {
                "x-curlcast-operator": String(authorization.role !== "viewer"),
                "x-curlcast-account-role": authorization.role,
                "access-control-expose-headers":
                  "x-curlcast-operator, x-curlcast-account-role",
              }
            : undefined,
      });
    if (!authorization.ok && !publicBroadcast)
      return readFailure(authorization.reason);
    if (result.kind !== "active") return readFailure(result.kind);
    if (
      authorization.ok &&
      authorization.via === "account" &&
      authorization.role === "viewer"
    )
      return readFailure("unauthorized");
    const game = result.game;
    // Recheck the current snapshot in case a participant was released during authorization.
    if (
      authorization.ok &&
      authorization.via === "token" &&
      authorization.access.purpose === "participant"
    ) {
      if (!participantAccessMatches(game, authorization.access))
        return readFailure("released");
    }
    if (publicBroadcast) {
      try {
        const sponsors = await gameBroadcastSponsors(id);
        return gameResponse(broadcastGame(game, sponsors));
      } catch {
        // Sponsor enrichment is optional. Do not fall back to stored sponsor
        // metadata when the organization-scoped lookup cannot be verified.
        return gameResponse(broadcastGame({ ...game, sponsors: [] }));
      }
    }
    if (view.data === "join") return gameResponse(joinGame(game));
    if (!authorization.ok) return readFailure("unauthorized");
    let responseGame = game;
    try {
      const sponsors = await gameLibrarySponsors(
        id,
        authorization.via === "account"
          ? authorization.organizationId
          : undefined,
      );
      // An empty library intentionally retains legacy per-game sponsor state.
      if (sponsors.length) responseGame = { ...game, sponsors };
    } catch {
      // Preserve the authorized state read, but omit ads whose organization
      // membership and signed render URLs could not be verified.
      responseGame = { ...game, sponsors: [] };
    }
    return gameResponse(responseGame, {
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role":
          authorization.via === "account" ? authorization.role : "",
        "access-control-expose-headers":
          "x-curlcast-operator, x-curlcast-account-role",
      },
    });
  } catch {
    return readFailure("unavailable");
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose !== "invitation",
  });
  if (!authorization.ok) {
    const failure = authorizationError(authorization);
    return gameResponse({ error: failure.error }, { status: failure.status });
  }
  const existing = await getGame(id);
  if (existing?.status === "closed")
    return gameResponse({ error: "This game is closed" }, { status: 410 });
  const body = actionSchema.safeParse(await request.json());
  if (!body.success)
    return gameResponse({ error: "Invalid update" }, { status: 400 });
  if (
    body.data.type === "sponsors" &&
    body.data.sponsors.some(
      (sponsor) => !hasSafeSponsorContent(sponsor.dataUrl),
    )
  )
    return gameResponse(
      { error: "Sponsor content is not a supported image" },
      { status: 400 },
    );
  if (
    authorization.via === "token" &&
    authorization.access.purpose === "participant" &&
    authorization.access.role !== "scorer" &&
    !(
      (body.data.type === "connection" ||
        body.data.type === "camera-health" ||
        body.data.type === "camera-framing") &&
      body.data.role === authorization.access.role
    )
  )
    return gameResponse(
      { error: "This role cannot make that update" },
      { status: 403 },
    );
  if (
    body.data.type === "close-game" &&
    authorization.via === "token" &&
    authorization.access.purpose !== "organizer"
  )
    return gameResponse(
      { error: "Only an organizer can close a game" },
      { status: 403 },
    );
  let game;
  try {
    const expectedAuthority =
      authorization.via === "token" &&
      authorization.access.purpose === "participant"
        ? {
            role: authorization.access.role!,
            claim: authorization.access.deviceId!,
            generation: authorization.access.assignmentGeneration,
          }
        : undefined;
    game = await updateGame(id, body.data, expectedAuthority);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Hammer must be selected"))
      return gameResponse({ error: message }, { status: 409 });
    if (
      message.includes("Score update conflict") ||
      isGameStateConflictError(error)
    )
      return gameResponse(
        { error: "The game changed before this update was saved. Try again." },
        { status: 409 },
      );
    return gameResponse(
      { error: "That update could not be saved." },
      { status: 500 },
    );
  }
  return game
    ? gameResponse(game)
    : gameResponse({ error: "Game not found" }, { status: 404 });
}
