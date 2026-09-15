import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  changeCurlCoachAccess,
  curlCoachAdminEnabled,
  setCurlCoachEntitlement,
} from "@/lib/providers/curlcoach-admin";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";

const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

const schema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("seats"),
      organizationId: z.uuid(),
      seats: z.number().int().min(1).max(100),
    })
    .strict(),
  z.object({
    action: z.literal("entitlement"),
    organizationId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({
    action: z.literal("grant"),
    targetUserId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }),
  z.object({ action: z.literal("revoke"), targetUserId: z.uuid() }),
]);

function unavailable() {
  return reply(
    {
      available: false,
      error: "CurlCoach is not enabled for this deployment.",
    },
    404,
  );
}

export async function GET() {
  try {
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    if (!curlCoachAdminEnabled()) return unavailable();
    return reply({ available: true });
  } catch {
    return reply({ error: "CurlCoach administration is unavailable." }, 503);
  }
}

export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open administration on this website." }, 403);
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    if (!curlCoachAdminEnabled()) return unavailable();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return reply({ error: "Check the entered details." }, 400);

    const body = parsed.data;
    if (body.action === "seats") {
      const { error } = await createAdminSupabaseClient().rpc(
        "set_curlcoach_seats",
        {
          p_actor: user.id,
          p_organization_id: body.organizationId,
          p_seats: body.seats,
        },
      );
      if (error) throw error;
    } else if (body.action === "entitlement") {
      await setCurlCoachEntitlement({
        actorUserId: user.id,
        organizationId: body.organizationId,
        expiresAt: body.expiresAt,
      });
    } else {
      await changeCurlCoachAccess({
        actorUserId: user.id,
        targetUserId: body.targetUserId,
        action: body.action,
        ...(body.action === "grant" ? { expiresAt: body.expiresAt } : {}),
      });
    }
    return reply({ saved: true });
  } catch {
    return reply({ error: "The CurlCoach change could not be saved." }, 409);
  }
}
