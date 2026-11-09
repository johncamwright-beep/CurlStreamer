import { NextResponse } from "next/server";
import { z } from "zod";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { pilotInput } from "@/lib/pilot";
import { sendPilotCredentials } from "@/lib/providers/pilot-accounts";
export const maxDuration = 60;
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET() {
  const user = await platformAdminContext();
  if (!user) return reply({ error: "Administrator access required." }, 403);
  const db = createAdminSupabaseClient();
  const { data, error } = await db.rpc("list_pilot_accounts", {
    p_actor: user.id,
  });
  if (error) return reply({ error: "Pilots unavailable." }, 503);
  return reply({ pilots: data ?? [] });
}
const actionSchema = z.discriminatedUnion("action", [
  pilotInput.extend({ action: z.literal("create") }),
  z.object({ action: z.literal("resend"), id: z.uuid() }),
  z.object({
    action: z.literal("access"),
    id: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
    revoke: z.boolean(),
  }),
]);
export async function POST(request: Request) {
  if (!sameOriginWrite(request))
    return reply({ error: "Open App Admin on this website." }, 403);
  const user = await platformAdminContext();
  if (!user) return reply({ error: "Administrator access required." }, 403);
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return reply({ error: "Check all contact and access fields." }, 400);
  const b = parsed.data,
    db = createAdminSupabaseClient();
  if (b.action === "access") {
    const { error } = await db.rpc("manage_pilot_account", {
      p_actor: user.id,
      p_id: b.id,
      p_expires: b.expiresAt,
      p_revoke: b.revoke,
    });
    return error
      ? reply({ error: "Access could not be updated." }, 409)
      : reply({ saved: true });
  }
  let id: string;
  if (b.action === "create") {
    const { data, error } = await db.rpc("prepare_pilot_account", {
      p_actor: user.id,
      p_email: b.email,
      p_name: b.name,
      p_phone: b.phone,
      p_team: b.team,
      p_expires: b.expiresAt,
      p_seats: b.coachSeats,
    });
    if (error || !data)
      return reply(
        {
          error:
            error?.code === "23505"
              ? "That email already has an account or pilot. No password was changed. Use the existing pilot controls, or review the account in App Admin."
              : "Pilot could not be created. Check the expiry date.",
        },
        409,
      );
    id = data.id;
  } else id = b.id;
  try {
    return reply({ saved: true, ...(await sendPilotCredentials(user.id, id)) });
  } catch {
    return reply(
      {
        saved: true,
        error:
          "Invitation could not finish. The pilot is saved; refresh and retry sending from its card.",
      },
      503,
    );
  }
}
