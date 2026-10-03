import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { ensureOwnProfile } from "@/lib/auth/profile";
import { sameOriginWrite } from "@/lib/providers/platform-admin";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open the invitation on this website." }, 403);
    const {
      data: { user },
    } = await (await createServerSupabaseClient()).auth.getUser();
    if (!user?.email_confirmed_at)
      return reply(
        { error: "Sign in with the verified email address that was invited." },
        401,
      );
    const parsed = z
      .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return reply({ error: "This invitation link is invalid." }, 400);
    await ensureOwnProfile(user);
    const { error } = await createAdminSupabaseClient().rpc(
      "accept_team_member_invitation",
      {
        p_user: user.id,
        p_hash: createHash("sha256").update(parsed.data.token).digest("hex"),
      },
    );
    if (error)
      return reply(
        {
          error:
            error.code === "23514"
              ? "This account already belongs to a team, or the team has reached its two-login limit."
              : "This invitation is expired, revoked, or intended for a different email address.",
        },
        409,
      );
    return reply({ success: true });
  } catch {
    return reply(
      { error: "The invitation could not be accepted. Please try again." },
      503,
    );
  }
}
