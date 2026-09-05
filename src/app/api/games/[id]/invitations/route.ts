import { NextResponse } from "next/server";
import { z } from "zod";
import { participantUrl } from "@/lib/participant-links";
import { issueChooserToken, issueRoleToken } from "@/lib/tokens";
import { prepareRoleInvitation } from "@/lib/store";
import {
  authorizeGame,
  operatorRoles,
  authorizationError,
} from "@/lib/game-authorization";
const roleSchema = z.enum(["camera-home", "camera-away", "scorer", "chooser"]);
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) =>
      access.purpose === "organizer" ||
      (access.purpose === "invitation" && !access.role),
  });
  if (!authorization.ok) {
    const failure = authorizationError(authorization);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
  const parsed = roleSchema.safeParse((await request.json()).role);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  const chooserExchange =
    authorization.via === "token" &&
    authorization.access.purpose === "invitation" &&
    !authorization.access.role;
  if (parsed.data === "chooser" && chooserExchange)
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const expiresAt = new Date(Date.now() + 1_800_000).toISOString();
  let token: string;
  if (parsed.data === "chooser") token = await issueChooserToken(id);
  else {
    const invitationId = crypto.randomUUID();
    const prepared = await prepareRoleInvitation(
      id,
      parsed.data,
      invitationId,
      expiresAt,
    );
    if (prepared.error)
      return NextResponse.json({ error: prepared.error }, { status: 409 });
    token = await issueRoleToken(
      id,
      parsed.data,
      invitationId,
      prepared.generation,
    );
  }
  const parameter = parsed.data === "chooser" ? "chooser" : "token";
  const url = participantUrl(
    request,
    `/join/${encodeURIComponent(id)}?${parameter}=${encodeURIComponent(token)}`,
  );
  return NextResponse.json(
    { token, url, expiresIn: 1800, expiresAt },
    { headers: { "cache-control": "no-store" } },
  );
}
