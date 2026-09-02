import { NextResponse } from "next/server";
import { z } from "zod";
import { getGameStore } from "@/lib/store";
import {
  issueChooserToken,
  issueRoleToken,
  readAccessToken,
} from "@/lib/tokens";
const roleSchema = z.enum(["camera-home", "camera-away", "scorer", "chooser"]);
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await getGameStore().getGame(id);
  if (!game)
    return NextResponse.json({ error: "Game not found" }, { status: 404 });
  if (game.status === "closed")
    return NextResponse.json({ error: "This game is closed" }, { status: 410 });
  const bearer = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!bearer)
    return NextResponse.json(
      { error: "Invitation access is required" },
      { status: 401 },
    );
  let access;
  try {
    access = await readAccessToken(bearer);
  } catch {
    return NextResponse.json(
      { error: "Invitation access expired" },
      { status: 401 },
    );
  }
  const canInvite =
    access.gameId === id &&
    (access.purpose === "organizer" ||
      (access.purpose === "invitation" && !access.role));
  if (!canInvite)
    return NextResponse.json(
      { error: "Not authorized to invite this role" },
      { status: 403 },
    );
  const parsed = roleSchema.safeParse((await request.json()).role);
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  if (parsed.data === "chooser" && access.purpose !== "organizer")
    return NextResponse.json({ error: "Not authorized" }, { status: 403 });
  const token =
    parsed.data === "chooser"
      ? await issueChooserToken(id)
      : await issueRoleToken(id, parsed.data);
  if (parsed.data !== "chooser")
    await getGameStore().registerInvitation(id, token, parsed.data);
  return NextResponse.json({ token, expiresIn: 1800 });
}
