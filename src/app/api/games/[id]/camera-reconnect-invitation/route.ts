import { NextResponse } from "next/server";
import { z } from "zod";
import {
  authorizeGame,
  authorizationError,
  operatorRoles,
} from "@/lib/game-authorization";
import { prepareCameraReconnect } from "@/lib/store";
import { issueCameraReconnectToken } from "@/lib/tokens";
import { participantUrl } from "@/lib/participant-links";
import { rateLimit } from "@/lib/rate-limit";

const input = z
  .object({ role: z.enum(["camera-home", "camera-away"]) })
  .strict();
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success)
    return NextResponse.json({ error: "Invalid game" }, { status: 400 });
  const body = input.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "Invalid camera" }, { status: 400 });
  const auth = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose === "organizer",
  });
  if (!auth.ok) {
    const failure = authorizationError(auth);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
  try {
    if (!(await rateLimit(`camera-reconnect:${id}:${body.data.role}`, 30)))
      return NextResponse.json(
        { error: "Wait a minute before creating another reconnect code." },
        { status: 429 },
      );
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    const invitationId = crypto.randomUUID();
    const prepared = await prepareCameraReconnect(
      id,
      body.data.role,
      invitationId,
      expiresAt,
    );
    if (
      prepared.error ||
      prepared.deviceId === undefined ||
      prepared.generation === undefined
    )
      return NextResponse.json(
        { error: prepared.error ?? "Camera unavailable" },
        { status: 409 },
      );
    const token = await issueCameraReconnectToken(
      id,
      body.data.role,
      invitationId,
      prepared.deviceId,
      prepared.generation,
    );
    const page = `/studio-m2/${id}/camera/${body.data.role}#${new URLSearchParams({ token })}`;
    return NextResponse.json(
      { url: participantUrl(request, page), expiresAt },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not renew camera access. Try again shortly." },
      { status: 503 },
    );
  }
}
