import { NextResponse } from "next/server";
import { actionSchema, hasSafeSponsorContent } from "@/lib/schema";
import { getGame, updateGame } from "@/lib/store";
import {
  authorizationError,
  authorizeGame,
  operatorRoles,
} from "@/lib/game-authorization";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: () => true,
  });
  if (!authorization.ok && authorization.reason === "deleted")
    return NextResponse.json(authorizationError(authorization), {
      status: 410,
    });
  const game = await getGame(id);
  return game
    ? NextResponse.json(game, {
        headers: {
          "x-curlcast-operator": authorization.ok ? "true" : "false",
          "x-curlcast-account-role":
            authorization.ok && authorization.via === "account"
              ? authorization.role
              : "",
          "access-control-expose-headers":
            "x-curlcast-operator, x-curlcast-account-role",
        },
      })
    : NextResponse.json({ error: "Game not found" }, { status: 404 });
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const authorization = await authorizeGame(request, id, {
    accountRoles: operatorRoles,
    tokenAllowed: (access) => access.purpose !== "invitation",
  });
  if (!authorization.ok) {
    const failure = authorizationError(authorization);
    return NextResponse.json(
      { error: failure.error },
      { status: failure.status },
    );
  }
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
    authorization.via === "token" &&
    authorization.access.purpose === "participant" &&
    authorization.access.role !== "scorer" &&
    !(
      (body.data.type === "connection" ||
        body.data.type === "camera-health" ||
        body.data.type === "camera-framing") &&
      body.data.role === authorization.access.role
    )
  )
    return NextResponse.json(
      { error: "This role cannot make that update" },
      { status: 403 },
    );
  if (
    body.data.type === "close-game" &&
    authorization.via === "token" &&
    authorization.access.purpose !== "organizer"
  )
    return NextResponse.json(
      { error: "Only an organizer can close a game" },
      { status: 403 },
    );
  let game;
  try {
    game = await updateGame(id, body.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Hammer must be selected"))
      return NextResponse.json({ error: message }, { status: 409 });
    if (message.includes("Score update conflict"))
      return NextResponse.json(
        { error: "The game changed before this update was saved. Try again." },
        { status: 409 },
      );
    return NextResponse.json(
      { error: "That update could not be saved." },
      { status: 500 },
    );
  }
  return game
    ? NextResponse.json(game)
    : NextResponse.json({ error: "Game not found" }, { status: 404 });
}
