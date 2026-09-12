import { NextResponse } from "next/server";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { sameOriginWrite } from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { manageMember, memberActionSchema } from "@/lib/providers/team-members";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth) return reply({ error: "Sign in to your team account." }, 403);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "list_team_members",
      { p_user: auth.user.id },
    );
    if (error) throw error;
    return reply(data);
  } catch {
    return reply({ error: "Team access is temporarily unavailable." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open Team access on this website." }, 403);
    const auth = await teamSettingsContext(true);
    if (!auth)
      return reply({ error: "Team administrator access required." }, 403);
    const parsed = memberActionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success)
      return reply({ error: "Check the email and role." }, 400);
    return reply(
      await manageMember(
        auth.user.id,
        parsed.data,
        process.env.APP_BASE_URL || new URL(request.url).origin,
      ),
    );
  } catch (error) {
    return reply(
      {
        error:
          (error as { code?: string }).code === "23514"
            ? "A team can have only two logins, including a pending invitation. The invited email must not already belong to another team."
            : "The member change could not be saved.",
      },
      409,
    );
  }
}
