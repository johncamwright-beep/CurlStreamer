import { NextResponse } from "next/server";
import { z } from "zod";
import { removeCameraParticipant } from "@/lib/providers/livekit";
import { getGame, updateGame } from "@/lib/store";
import {
  authorizeGame,
  operatorRoles,
  authorizationError,
} from "@/lib/game-authorization";
import { isGameStateConflictError } from "@/lib/game-state-conflict";

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
  const claim = game.claims[parsed.data.role];
  if (!claim) return NextResponse.json({ disconnected: true, game });
  try {
    await removeCameraParticipant(id, parsed.data.role);
  } catch {
    console.error("Camera disconnect failed", {
      operation: "remove_livekit_participant",
      category: "livekit_service",
    });
    return NextResponse.json(
      { error: "The live camera could not be disconnected." },
      { status: 503 },
    );
  }
  let disconnected;
  try {
    disconnected = await updateGame(
      id,
      {
        type: "camera-health",
        role: parsed.data.role,
        phase: "disconnected",
        diagnostic: "Disconnected by organizer",
      },
      claim,
    );
  } catch (error) {
    if (isGameStateConflictError(error))
      return NextResponse.json(
        {
          error:
            "The game changed before the camera state was saved. Try again.",
        },
        { status: 409 },
      );
    throw error;
  }
  return NextResponse.json({
    disconnected: true,
    game: disconnected,
  });
}
