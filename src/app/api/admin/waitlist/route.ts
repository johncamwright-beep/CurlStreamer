import { NextResponse } from "next/server";
import { z } from "zod";
import {
  platformAdminContext,
  sameOriginWrite,
} from "@/lib/providers/platform-admin";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  notifyWaitlistSignup,
  waitlistRecipient,
} from "@/lib/providers/waitlist-notification";
import { reportMailConfig } from "@/lib/providers/report-email-transport";
const reply = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(request: Request) {
  try {
    if (!(await platformAdminContext()))
      return reply({ error: "Platform administrator access required." }, 403);
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .safeParse(new URL(request.url).searchParams.get("page") ?? 0);
    if (!page.success) return reply({ error: "Invalid page." }, 400);
    const { data, error, count } = await createAdminSupabaseClient()
      .from("pilot_waitlist")
      .select(
        "id,email,team,consent_version,created_at,notification_status,notification_attempted_at,notification_sent_at",
        { count: "exact" },
      )
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page.data * 50, page.data * 50 + 49);
    if (error) throw error;
    return reply({
      entries: data,
      total: count,
      page: page.data,
      recipient: waitlistRecipient,
      emailConfigured: reportMailConfig().success,
    });
  } catch {
    return reply({ error: "Waitlist is temporarily unavailable." }, 503);
  }
}
export async function POST(request: Request) {
  try {
    if (!sameOriginWrite(request) || !(await platformAdminContext()))
      return reply({ error: "Platform administrator access required." }, 403);
    const parsed = z
      .object({ id: z.uuid() })
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success) return reply({ error: "Invalid signup." }, 400);
    const { data, error } = await createAdminSupabaseClient()
      .from("pilot_waitlist")
      .select("email,notification_status")
      .eq("id", parsed.data.id)
      .single();
    if (error || !data) return reply({ error: "Signup not found." }, 404);
    if (!["pending", "failed"].includes(data.notification_status))
      return reply(
        {
          error:
            "This notification cannot be retried automatically. Check the Hello inbox first.",
        },
        409,
      );
    await notifyWaitlistSignup(data.email);
    return reply({ ok: true });
  } catch {
    return reply(
      {
        error:
          "Notification could not be completed. The signup is still saved.",
      },
      503,
    );
  }
}
