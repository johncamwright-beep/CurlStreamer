import { NextResponse } from "next/server";
import { z } from "zod";
import { removeCameraParticipant } from "@/lib/providers/livekit";
import { getGame, updateGame } from "@/lib/store";
import {
  authorizeGame,
  operatorRoles,
  authorizationError,
} from "@/lib/game-authorization";

const requestSchema = z.object({
  role: z.enum(["camera-home", "camera-away"]),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose === "organizer",
  });
  if (!authorization.ok) {
    const failure = authorizationError(authorization);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
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
