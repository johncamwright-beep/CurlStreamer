import { NextResponse } from "next/server";
import { gameSchema } from "@/lib/schema";
import { rateLimit } from "@/lib/rate-limit";
import { issueOrganizerToken } from "@/lib/tokens";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAuthenticatedTeamGame } from "@/lib/team-games";
export async function POST(request: Request) {
  const client =
    request.headers.get("x-forwarded-for")?.split(",")[0] ?? "local";
  if (!rateLimit(`create:${client}`, 10))
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  let user;
  try {
    const supabase = await createServerSupabaseClient();
    const result = await supabase.auth.getUser();
    if (result.error || !result.data.user)
      return NextResponse.json(
        { error: "Sign in is required to create a game." },
        { status: 401 },
      );
    user = result.data.user;
  } catch {
    return NextResponse.json(
      { error: "Your sign-in session could not be verified." },
      { status: 401 },
    );
  }
  const body = gameSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json(
      {
        error: "Check the highlighted game details.",
        issues: body.error.flatten(),
      },
      { status: 400 },
    );
  let game;
  {
    if (!user.email_confirmed_at)
      return NextResponse.json(
        { error: "Verify your email before creating a team game." },
        { status: 403 },
      );
    const result = await createAuthenticatedTeamGame(user, body.data);
    const failures = {
      inactive: [403, "This account is not active."],
      "no-team": [409, "Team setup is required before creating a game."],
      "multiple-teams": [
        409,
        "Team selection is required before creating a game.",
      ],
      forbidden: [403, "Viewers cannot create games."],
      unavailable: [503, "Team game creation is temporarily unavailable."],
    } as const;
    if (result.kind !== "created") {
      const [status, error] = failures[result.kind];
      return NextResponse.json({ error }, { status });
    }
    game = result.game;
  }
  return NextResponse.json(
    { ...game, organizerToken: await issueOrganizerToken(game.id) },
    { status: 201 },
  );
}
