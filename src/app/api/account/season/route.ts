import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit } from "@/lib/rate-limit";
import { teamSettingsContext } from "@/lib/providers/team-settings";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  seasonConfig,
  seasonCheckout,
  cancelSeasonCheckout,
  readSeasonPurchase,
} from "@/lib/providers/stripe-season";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const auth = await teamSettingsContext();
    if (!auth) return reply({ error: "Sign in to your team." }, 403);
    const access = await createAdminSupabaseClient().rpc(
      "read_team_commercial_access",
      { p_user: auth.user.id },
    );
    if (access.error) throw access.error;
    const c = seasonConfig();
    return reply({
      access: access.data,
      purchase: c ? await readSeasonPurchase(auth.organizationId) : null,
      available: Boolean(c && (c.live || (await platformAdminContext()))),
      mode: c?.live ? "live" : "test",
      canManage: ["owner", "team_admin"].includes(auth.role),
      basePrice: 89,
      coachPrice: 39,
    });
  } catch {
    return reply({ error: "Season access could not be loaded." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open checkout from your account." }, 403);
    const auth = await teamSettingsContext(true);
    if (!auth) return reply({ error: "Full team access required." }, 403);
    const c = seasonConfig();
    if (!c || (!c.live && !(await platformAdminContext())))
      return reply({ error: "Checkout is not available yet." }, 403);
    const body = z
      .union([
        z.object({ action: z.literal("cancel") }).strict(),
        z
          .object({
            base: z.boolean(),
            coaches: z.number().int().min(0).max(2),
          })
          .refine((value) => value.base || value.coaches > 0)
          .strict(),
      ])
      .safeParse(await request.json().catch(() => null));
    if (!body.success)
      return reply(
        { error: "Choose a season pass and coaching licences." },
        400,
      );
    try {
      if (!(await rateLimit(`season-checkout:${auth.organizationId}`, 10)))
        return NextResponse.json(
          { error: "Too many checkout attempts. Wait a minute and try again." },
          {
            status: 429,
            headers: {
              "Cache-Control": "private, no-store",
              "Retry-After": "60",
            },
          },
        );
    } catch {
      return reply(
        { error: "Checkout is temporarily unavailable. Please retry shortly." },
        503,
      );
    }
    if ("action" in body.data) {
      await cancelSeasonCheckout(auth.organizationId);
      return reply({ cancelled: true });
    }
    return reply({
      url: await seasonCheckout(
        auth.user.id,
        auth.organizationId,
        body.data.base,
        body.data.coaches,
      ),
    });
  } catch {
    return reply(
      {
        error:
          "Checkout could not open. Finish any pending checkout, or reload your season access and check your existing licences.",
      },
      409,
    );
  }
}
