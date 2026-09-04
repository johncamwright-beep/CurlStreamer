import { NextResponse } from "next/server";
import { z } from "zod";
import { participantUrl } from "@/lib/participant-links";
import { issueChooserToken, issueRoleToken } from "@/lib/tokens";
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
  if (
    parsed.data === "chooser" &&
    authorization.via === "token" &&
    authorization.access.purpose !== "organizer"
  )
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const token =
    parsed.data === "chooser"
      ? await issueChooserToken(id)
      : await issueRoleToken(id, parsed.data);
  const parameter = parsed.data === "chooser" ? "chooser" : "token";
  const url = participantUrl(
    request,
    `/join/${encodeURIComponent(id)}?${parameter}=${encodeURIComponent(token)}`,
  );
  return NextResponse.json({ token, url, expiresIn: 1800 });
}
