import { NextResponse } from "next/server";
import { actionSchema, hasSafeSponsorContent } from "@/lib/schema";
import { getGame, updateGame } from "@/lib/store";
import { readAccessToken } from "@/lib/tokens";
export const dynamic = "force-dynamic";
export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const game = await getGame(id);
  return game
    ? NextResponse.json(game)
    : NextResponse.json({ error: "Game not found" }, { status: 404 });
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
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
  if (access.gameId !== id || access.purpose === "invitation")
    return NextResponse.json(
      { error: "This access cannot update the game" },
      { status: 403 },
    );
  const existing = await getGame(id);
  if (existing?.status === "closed")
    return NextResponse.json({ error: "This game is closed" }, { status: 410 });
  const body = actionSchema.safeParse(await request.json());
  if (!body.success)
    return NextResponse.json({ error: "Invalid update" }, { status: 400 });
  if (
    body.data.type === "sponsors" &&
    body.data.sponsors.some(
      (sponsor) => !hasSafeSponsorContent(sponsor.dataUrl),
    )
  )
    return NextResponse.json(
      { error: "Sponsor content is not a supported image" },
      { status: 400 },
    );
  if (
    access.purpose === "participant" &&
    access.role !== "scorer" &&
    !(
      (body.data.type === "connection" ||
        body.data.type === "camera-health" ||
        body.data.type === "camera-framing") &&
      body.data.role === access.role
    )
  )
    return NextResponse.json(
      { error: "This role cannot make that update" },
      { status: 403 },
    );
  if (body.data.type === "close-game" && access.purpose !== "organizer")
    return NextResponse.json(
      { error: "Only an organizer can close a game" },
      { status: 403 },
    );
  const game = await updateGame(id, body.data);
  return game
    ? NextResponse.json(game)
    : NextResponse.json({ error: "Game not found" }, { status: 404 });
}
