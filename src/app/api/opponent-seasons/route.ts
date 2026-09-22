import { NextResponse } from "next/server";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  opponentSeasonInputSchema,
  opponentSeasonSchema,
} from "@/lib/opponent-seasons";
const headers = { "Cache-Control": "private, no-store" };
async function verifiedUser() {
  const {
    data: { user },
  } = await (await createServerSupabaseClient()).auth.getUser();
  return user?.email_confirmed_at ? user : null;
}
function failure(code?: string) {
  const status =
    code === "42501"
      ? 403
      : ["40001", "23505", "23514"].includes(code ?? "")
        ? 409
        : ["22023", "22P02"].includes(code ?? "")
          ? 400
          : 503;
  return NextResponse.json(
    {
      error:
        status === 403
          ? "You cannot edit this opponent's season."
          : status === 409
            ? "These season details changed elsewhere. Reload them before saving again."
            : status === 400
              ? "Check the season, competition level and player names."
              : "Opponent season details are temporarily unavailable.",
    },
    { status, headers },
  );
}
export async function GET() {
  try {
    const user = await verifiedUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in to view opponent details." },
        { status: 401, headers },
      );
    const admin = createAdminSupabaseClient();
    const [profiles, seasons] = await Promise.all([
      admin.rpc("list_opponent_seasons", { p_user_id: user.id }),
      admin.rpc("list_seasons", { p_user_id: user.id }),
    ]);
    if (profiles.error || seasons.error)
      return failure(profiles.error?.code || seasons.error?.code);
    return NextResponse.json(
      {
        profiles: z.array(opponentSeasonSchema).parse(profiles.data ?? []),
        seasons: z
          .array(
            z.object({ id: z.uuid(), name: z.string(), status: z.string() }),
          )
          .parse(seasons.data ?? []),
      },
      { headers },
    );
  } catch {
    return failure();
  }
}
export async function POST(request: Request) {
  try {
    const user = await verifiedUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in to save opponent details." },
        { status: 401, headers },
      );
    const parsed = opponentSeasonInputSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) return failure("22023");
    const input = parsed.data;
    const { data, error } = await createAdminSupabaseClient().rpc(
      "save_opponent_season",
      {
        p_user_id: user.id,
        p_opponent_id: input.opponentId,
        p_season_id: input.seasonId,
        p_level: input.level,
        p_roster: input.roster,
        p_expected_revision: input.expectedRevision,
      },
    );
    if (error) return failure(error.code);
    return NextResponse.json(
      { profile: opponentSeasonSchema.parse(data?.[0]) },
      { headers },
    );
  } catch {
    return failure();
  }
}
