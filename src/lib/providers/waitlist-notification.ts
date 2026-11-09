import "server-only";
import nodemailer from "nodemailer";
import { z } from "zod";
import { reportMailConfig } from "./report-email-transport";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const waitlistRecipient = "hello@curlstreamer.app";
const claimedSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  team: z.string(),
  created_at: z.string(),
  notification_attempt_id: z.uuid(),
});

export async function notifyWaitlistSignup(email: string) {
  const db = createAdminSupabaseClient();
  const { data, error } = await db.rpc("claim_waitlist_notification", {
    p_email: email,
  });
  if (error) throw Error("Notification unavailable");
  if (!data?.length) return;
  const row = claimedSchema.parse(data[0]);
  const config = reportMailConfig();
  let status: "accepted" | "failed" | "unknown" = "failed";
  if (config.success) {
    const c = config.data;
    const transport = nodemailer.createTransport({
      host: c.host,
      port: Number(c.port),
      secure: c.port === "465",
      requireTLS: true,
      auth: { user: c.user, pass: c.password },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    try {
      const result = await transport.sendMail({
        from: { name: "CurlStreamer", address: c.from },
        to: waitlistRecipient,
        subject: "New CurlStreamer waitlist signup",
        messageId: `<waitlist-${row.id}@curlstreamer.app>`,
        text: `A new person joined the CurlStreamer waitlist.\n\nEmail: ${row.email}\nTeam: ${row.team || "Not provided"}\nSigned up: ${row.created_at}\n\nView the waitlist: https://www.curlstreamer.app/admin/waitlist`,
      });
      status = result.accepted.length > 0 ? "accepted" : "failed";
    } catch {
      // SMTP may time out after accepting mail. Do not automatically resend.
      status = "unknown";
    } finally {
      transport.close();
    }
  }
  const finished = await db.rpc("finish_waitlist_notification", {
    p_id: row.id,
    p_attempt: row.notification_attempt_id,
    p_status: status,
  });
  if (finished.error) throw Error("Notification status unavailable");
}
