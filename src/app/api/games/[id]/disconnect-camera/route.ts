import { NextResponse } from "next/server";
import { z } from "zod";
import { removeCameraParticipant } from "@/lib/providers/livekit";
import { getGame, updateGame } from "@/lib/store";
import { readAccessToken } from "@/lib/tokens";

const requestSchema = z.object({
  role: z.enum(["camera-home", "camera-away"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer)
    return NextResponse.json(
      { error: "Organizer access required" },
      { status: 401 },
    );
  let access;
  try {
    access = await readAccessToken(bearer);
  } catch {
    return NextResponse.json(
      { error: "Organizer access expired" },
      { status: 401 },
    );
  }
  if (access.purpose !== "organizer" || access.gameId !== id)
    return NextResponse.json(
      { error: "Organizer access required for this game" },
      { status: 403 },
    );
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid camera role" }, { status: 400 });
  const game = await getGame(id);
  if (!game)
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (!game.claims[parsed.data.role])
    return NextResponse.json(
      { error: "That camera role is not claimed" },
      { status: 409 },
    );
  await removeCameraParticipant(id, parsed.data.role);
  await updateGame(id, {
    type: "camera-health",
    role: parsed.data.role,
    phase: "disconnected",
    diagnostic: "Disconnected by organizer",
  });
  return NextResponse.json({ disconnected: true });
}
