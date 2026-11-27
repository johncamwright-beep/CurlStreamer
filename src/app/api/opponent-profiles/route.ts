import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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
      : code === "23505"
        ? 409
        : ["22023", "22P02"].includes(code ?? "")
          ? 400
          : 503;
  const error =
    status === 403
      ? "You cannot change this opponent."
      : status === 409
        ? "This profile is already linked to another saved opponent, or that name is linked to a different team. Open Opponents to review the existing link."
        : status === 400
          ? "Choose a published opponent profile."
          : "The team directory is temporarily unavailable. You can still save an opponent by name.";
  return NextResponse.json({ error }, { status, headers });
}
export async function GET(request: Request) {
  try {
    const user = await verifiedUser();
    if (!user)
      return NextResponse.json(
        { error: "Sign in to search teams." },
        { status: 401, headers },
      );
    const query = new URL(request.url).searchParams;
    const opponent = query.get("opponentId");
    const parsed =
      opponent !== null
        ? z.uuid().safeParse(opponent)
        : z.string().trim().min(2).max(100).safeParse(query.get("q"));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Enter at least two letters of the team name." },
        { status: 400, headers },
      );
    const { data, error } = await createAdminSupabaseClient().rpc(
      opponent !== null ? "read_opponent_profile" : "search_opponent_profiles",
      {
        p_user_id: user.id,
        ...(opponent !== null
          ? { p_opponent_id: parsed.data }
          : { p_query: parsed.data }),
      },
    );
    if (error) return failure(error.code);
    return NextResponse.json(
      opponent !== null
        ? { profile: data?.[0] ?? null }
        : { teams: data ?? [] },
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
        { error: "Sign in to link an opponent." },
        { status: 401, headers },
      );
    const parsed = z
      .object({
        opponentId: z.uuid().optional(),
        profileId: z.uuid().nullable(),
      })
      .refine((value) => value.profileId !== null || Boolean(value.opponentId))
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json(
        { error: "Choose an opponent and profile." },
        { status: 400, headers },
      );
    const { data, error } = await createAdminSupabaseClient().rpc(
      "link_opponent_profile",
      {
        p_user_id: user.id,
        p_opponent_id: parsed.data.opponentId ?? null,
        p_profile_id: parsed.data.profileId,
      },
    );
    if (error) return failure(error.code);
    if (!data?.[0]?.id) return failure();
    return NextResponse.json({ opponent: data?.[0] }, { headers });
  } catch {
    return failure();
  }
}
