import { NextResponse } from "next/server";
import { gameSchema } from "@/lib/schema";
import { createGame } from "@/lib/store";
import { rateLimit } from "@/lib/rate-limit";
import { issueOrganizerToken } from "@/lib/tokens";
export async function POST(request: Request) {
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (!rateLimit(`create:${client}`, 10))
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  const body = gameSchema.safeParse(await request.json());
  if (!body.success)
    return NextResponse.json(
      {
        error: "Check the highlighted game details.",
        issues: body.error.flatten(),
      },
      { status: 400 },
    );
  const game = await createGame(body.data);
  return NextResponse.json(
    { ...game, organizerToken: await issueOrganizerToken(game.id) },
    { status: 201 },
  );
}
