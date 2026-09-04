import { NextResponse } from "next/server";
import { z } from "zod";
import { getGame } from "@/lib/store";
import { issueLiveKitToken, type LiveKitAccess } from "@/lib/providers/livekit";
import {
  authorizeGame,
  operatorRoles,
  authorizationError,
} from "@/lib/game-authorization";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().min(1).max(100) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  const { id } = parsed.data;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose !== "invitation",
  });
  if (!authorization.ok) {
    const failure = authorizationError(authorization);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
  const role: LiveKitAccess | undefined =
    authorization.via === "account" ||
    authorization.access.purpose === "organizer"
      ? "organizer"
      : authorization.access.role === "camera-home" ||
          authorization.access.role === "camera-away"
        ? authorization.access.role
        : undefined;
  if (!role)
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const game = await getGame(id);
  if (!game)
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.status === "closed")
    return NextResponse.json({ error: "This game is closed" }, { status: 410 });
  try {
    return NextResponse.json(await issueLiveKitToken(id, role));
  } catch {
    return NextResponse.json(
      { error: "Live video is not configured" },
      { status: 503 },
    );
  }
}
