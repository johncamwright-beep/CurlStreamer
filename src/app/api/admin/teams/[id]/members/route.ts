import { NextResponse } from "next/server";
import { z } from "zod";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { manageMember, memberActionSchema } from "@/lib/providers/team-members";
type Context = { params: Promise<{ id: string }> };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(_: Request, context: Context) {
  try {
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    const org = z.uuid().parse((await context.params).id);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "list_team_members",
      { p_user: user.id, p_org: org },
    );
    if (error) throw error;
    return reply(data);
  } catch {
    return reply({ error: "Team access is unavailable." }, 503);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open administration on this website." }, 403);
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    const org = z.uuid().parse((await context.params).id),
      body = memberActionSchema.parse(await request.json());
    return reply(
      await manageMember(
        user.id,
        body,
        process.env.APP_BASE_URL || new URL(request.url).origin,
        org,
      ),
    );
  } catch {
    return reply(
      {
        error:
          "The member change was rejected. Check the two-login limit and invitation details.",
      },
      409,
    );
  }
}
