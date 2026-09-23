import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers });
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth) return reply({ error: "Sign in to your team account." }, 403);
    const { data, error } = await createAdminSupabaseClient()
      .from("team_access")
      .select("trial_expires_at")
      .eq("organization_id", auth.organizationId)
      .maybeSingle();
    if (error) throw error;
    const expiresAt = data?.trial_expires_at ?? null;
    return reply({
      expiresAt,
      status: !expiresAt
        ? "none"
        : Date.parse(expiresAt) > Date.now()
          ? "active"
          : "expired",
    });
  } catch {
    return reply(
      { error: "Trial details are temporarily unavailable. Please try again." },
      503,
    );
  }
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (!origin || origin !== new URL(request.url).origin)
      return reply({ error: "Open this form from Account & Settings." }, 403);
    const auth = await teamSettingsContext(true);
    if (!auth)
      return reply(
        { error: "A team owner or administrator must redeem the code." },
        403,
      );
    const text = await request.text();
    if (text.length > 512)
      return reply({ error: "Check the trial code." }, 400);
    const parsed = z
      .object({
        code: z
          .string()
          .trim()
          .max(80)
          .transform((value) => value.toUpperCase().replace(/[\s-]/g, ""))
          .pipe(z.string().regex(/^CURL[A-F0-9]{32}$/)),
      })
      .strict()
      .safeParse(JSON.parse(text));
    if (!parsed.success) return reply({ error: "Check the trial code." }, 400);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "redeem_team_trial",
      {
        p_user_id: auth.user.id,
        p_code_hash: createHash("sha256")
          .update(parsed.data.code)
          .digest("hex"),
      },
    );
    if (error)
      return reply(
        {
          error:
            error.code === "23514"
              ? "Your team has already redeemed a trial code."
              : error.code === "22023"
                ? "This code is invalid, expired, or already used by another team."
                : "The code could not be redeemed. Please try again.",
        },
        ["23514", "22023"].includes(error.code) ? 409 : 503,
      );
    return reply({ expiresAt: data, status: "active" });
  } catch {
    return reply(
      { error: "The code could not be redeemed. Please try again." },
      503,
    );
  }
}
