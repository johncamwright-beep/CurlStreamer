import { NextResponse } from "next/server";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { sameOriginWrite } from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { curlCoachAdminEnabled } from "@/lib/providers/curlcoach-admin";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
const schema = z.object({ membershipIds: z.array(z.uuid()).max(100) }).strict();
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth) return reply({ error: "Sign in to your team account." }, 403);
    if (!curlCoachAdminEnabled()) return reply({ available: false });
    const { data, error } = await createAdminSupabaseClient().rpc(
      "read_team_curlcoach",
      { p_actor: auth.user.id },
    );
    if (error) throw error;
    return reply({ available: true, ...data });
  } catch {
    return reply(
      { error: "Coaching licences could not be loaded. Try again." },
      503,
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open Team access on this website." }, 403);
    const auth = await teamSettingsContext(true);
    if (!auth || auth.role !== "owner")
      return reply(
        { error: "Only the team owner can assign coaching licences." },
        403,
      );
    if (!curlCoachAdminEnabled())
      return reply({ error: "CurlCoach is unavailable." }, 404);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return reply({ error: "Choose accepted team members." }, 400);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "assign_team_curlcoach",
      { p_actor: auth.user.id, p_membership_ids: parsed.data.membershipIds },
    );
    if (error) throw error;
    return reply({ available: true, ...data });
  } catch {
    return reply(
      {
        error:
          "Assignments were not saved. Check the active licences and team members, then reload.",
      },
      409,
    );
  }
}
