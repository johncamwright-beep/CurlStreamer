import { NextResponse } from "next/server";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { sameOriginWrite } from "@/lib/providers/platform-admin";
import {
  authorizeGame,
  authorizationError,
  operatorRoles,
} from "@/lib/game-authorization";
import {
  headshotInputSchema,
  coachHeadshotInputSchema,
  removeCelebrationHeadshot,
  readCelebrationHeadshots,
  saveCelebrationHeadshot,
  saveCelebrationCoachHeadshot,
  celebrationGameOrganization,
} from "@/lib/providers/celebration-headshots";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  try {
    const gameId = z
      .uuid()
      .optional()
      .safeParse(new URL(request.url).searchParams.get("gameId") ?? undefined);
    if (!gameId.success) return reply({ error: "Invalid game." }, 400);
    // Game-token reads remain usable if the optional account session is absent.
    const auth = gameId.data
      ? await teamSettingsContext().catch(() => null)
      : await teamSettingsContext();
    let organizationId = auth?.organizationId;
    if (gameId.data) {
      const access = await authorizeGame(request, gameId.data, {
        accountRoles: operatorRoles,
        tokenAllowed: (access) =>
          access.purpose === "organizer" ||
          (access.purpose === "participant" && access.role === "scorer"),
      });
      if (!access.ok) {
        const failure = authorizationError(access);
        return reply({ error: failure.error }, failure.status);
      }
      organizationId = await celebrationGameOrganization(gameId.data);
    }
    if (!organizationId)
      return reply({ error: "Sign in to your team account." }, 403);
    return reply({
      ...(await readCelebrationHeadshots(organizationId)),
      canEdit:
        auth?.organizationId === organizationId &&
        ["owner", "team_admin"].includes(auth.role),
    });
  } catch {
    return reply({ error: "Player photos are temporarily unavailable." }, 503);
  }
}
export async function POST(request: Request) {
  if (!sameOriginWrite(request))
    return reply({ error: "Open Studio on this website." }, 403);
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return reply({ error: "Team administrator access required." }, 403);
    if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024 + 16384)
      return reply({ error: "Photo is too large." }, 413);
    const form = await request.formData();
    const gameId = z
      .uuid()
      .optional()
      .safeParse(form.get("gameId") ?? undefined);
    if (!gameId.success) return reply({ error: "Invalid game." }, 400);
    if (gameId.data) {
      const access = await authorizeGame(request, gameId.data, {
        accountRoles: ["owner", "team_admin"],
        tokenAllowed: () => false,
      });
      if (!access.ok)
        return reply(
          { error: "Team administrator access to this game required." },
          403,
        );
      if (
        (await celebrationGameOrganization(gameId.data)) !== auth.organizationId
      )
        return reply(
          { error: "Open the team account that owns this game." },
          403,
        );
    }
    const kind = z
      .enum(["roster", "coach"])
      .safeParse(form.get("kind") ?? "roster");
    if (!kind.success)
      return reply({ error: "Choose a roster player or coach." }, 400);
    const file = form.get("image");
    if (!(file instanceof File))
      return reply({ error: "Choose a prepared PNG." }, 400);
    if (kind.data === "coach") {
      const coach = coachHeadshotInputSchema.safeParse({
        kind: "coach",
        playerName: form.get("playerName"),
        ...(form.get("playerId") ? { playerId: form.get("playerId") } : {}),
      });
      if (!coach.success)
        return reply(
          { error: "Enter a coach name up to 100 characters." },
          400,
        );
      return reply({
        ...(await saveCelebrationCoachHeadshot(
          auth.organizationId,
          coach.data,
          file,
        )),
        canEdit: true,
      });
    }
    const input = headshotInputSchema.safeParse({
      playerId: form.get("playerId"),
    });
    if (!input.success)
      return reply({ error: "Choose a roster player and prepared PNG." }, 400);
    return reply({
      ...(await saveCelebrationHeadshot(
        auth.organizationId,
        input.data.playerId,
        file,
      )),
      canEdit: true,
    });
  } catch {
    return reply(
      {
        error:
          "Photo could not be saved. Use a PNG under 2 MB and refresh if the roster changed.",
      },
      400,
    );
  }
}

export async function DELETE(request: Request) {
  if (!sameOriginWrite(request))
    return reply({ error: "Open Studio on this website." }, 403);
  try {
    const auth = await teamSettingsContext(true);
    if (!auth)
      return reply({ error: "Team administrator access required." }, 403);
    const input = z
      .object({ headshotId: z.uuid(), gameId: z.uuid().optional() })
      .strict()
      .safeParse(await request.json());
    if (!input.success) return reply({ error: "Invalid player photo." }, 400);
    if (input.data.gameId) {
      const access = await authorizeGame(request, input.data.gameId, {
        accountRoles: ["owner", "team_admin"],
        tokenAllowed: () => false,
      });
      if (
        !access.ok ||
        (await celebrationGameOrganization(input.data.gameId)) !==
          auth.organizationId
      )
        return reply(
          { error: "Team administrator access to this game required." },
          403,
        );
    }
    return reply({
      ...(await removeCelebrationHeadshot(
        auth.organizationId,
        input.data.headshotId,
      )),
      canEdit: true,
    });
  } catch {
    return reply({ error: "Player photo could not be removed." }, 400);
  }
}
