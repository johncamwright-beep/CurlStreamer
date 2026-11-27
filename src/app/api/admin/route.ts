import { NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  try {
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    const { data, error } = await createAdminSupabaseClient().rpc(
      "platform_account_overview",
      { p_user: user.id },
    );
    if (error) throw error;
    return reply(data);
  } catch {
    return reply({ error: "Administration is temporarily unavailable." }, 503);
  }
}
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("codes"),
    count: z.number().int().min(1).max(100),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
  z.object({
    action: z.enum(["suspend", "activate", "revokeCode", "view"]),
    target: z.uuid(),
  }),
  z.object({
    action: z.literal("trial"),
    target: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
  }),
]);
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request))
      return reply({ error: "Open administration on this website." }, 403);
    const user = await platformAdminContext();
    if (!user)
      return reply({ error: "Platform administrator access required." }, 403);
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return reply({ error: "Check the entered details." }, 400);
    const body = parsed.data,
      db = createAdminSupabaseClient();
    if (body.action === "codes") {
      const codes = Array.from(
        { length: body.count },
        () =>
          "CURL-" +
          randomBytes(16)
            .toString("hex")
            .toUpperCase()
            .match(/.{8}/g)!
            .join("-"),
      );
      const { error } = await db.rpc("platform_issue_trial_codes", {
        p_user: user.id,
        p_hashes: codes.map((code) =>
          createHash("sha256").update(code.replaceAll("-", "")).digest("hex"),
        ),
        p_expires: body.expiresAt,
      });
      if (error) throw error;
      return reply({ codes });
    }
    const { error } = await db.rpc("platform_manage_account", {
      p_user: user.id,
      p_action: body.action,
      p_target: body.target,
      ...(body.action === "trial" ? { p_expires: body.expiresAt } : {}),
    });
    if (error)
      return reply(
        {
          error:
            error.code === "23514"
              ? "This change is protected. Administrators cannot be suspended here, and redeemed codes cannot be revoked."
              : "The change could not be saved.",
        },
        409,
      );
    return reply({ saved: true });
  } catch {
    return reply(
      { error: "The administrative action could not be completed." },
      503,
    );
  }
}
