import { NextResponse } from "next/server";
import { z } from "zod";
import { removeCameraParticipant } from "@/lib/providers/livekit";
import { getGame, releaseRole } from "@/lib/store";
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
  const claim = game.claims[parsed.data.role];
  if (!claim)
    return NextResponse.json({ disconnected: true, released: false, game });
  try {
    await removeCameraParticipant(id, parsed.data.role);
  } catch {
    console.error("Camera release failed", {
      operation: "remove_livekit_participant",
      category: "livekit_service",
    });
    return NextResponse.json(
      { error: "The live camera could not be disconnected." },
      { status: 503 },
    );
  }
  const released = await releaseRole(id, parsed.data.role, claim);
  if (released.error)
    return NextResponse.json(
      { error: "The camera claim changed before it could be released." },
      { status: 409 },
    );
  return NextResponse.json({
    disconnected: true,
    released: true,
    game: released.game,
  });
}
