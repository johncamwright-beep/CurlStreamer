import { NextResponse } from "next/server";
import { z } from "zod";
import { getGame } from "@/lib/store";
import { readAccessToken } from "@/lib/tokens";
import { issueLiveKitToken, type LiveKitAccess } from "@/lib/providers/livekit";

export const dynamic = "force-dynamic";
const paramsSchema = z.object({ id: z.string().min(1).max(100) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer)
    return NextResponse.json(
      { error: "Game access is required" },
      { status: 401 },
    );

  let access;
  try {
    access = await readAccessToken(bearer);
  } catch {
    return NextResponse.json({ error: "Game access expired" }, { status: 401 });
  }
  const { id } = parsed.data;
  if (access.gameId !== id || access.purpose === "invitation")
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const role: LiveKitAccess | undefined =
    access.purpose === "organizer"
      ? "organizer"
      : access.role === "camera-home" || access.role === "camera-away"
        ? access.role
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
