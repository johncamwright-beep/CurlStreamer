import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
import { buildReportPDF } from "@/lib/curlcoach/report-pdf";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { currentPlayerContacts, readPlayerContacts } from "./player-contacts";
import {
  getEventReports,
  loadReportEvent,
  ReportError,
} from "./shot-tracker-reports";
import { deliverReportEmail, reportMailConfig } from "./report-email-transport";
export const emailSelection = z
  .object({
    eventId: z.uuid(),
    audience: z.enum(["team", "players"]),
    reportKey: z.string().min(1).max(100),
  })
  .strict();
export const emailRequest = emailSelection
  .extend({
    planToken: z.string().regex(/^[a-f0-9]{64}$/),
    resend: z.boolean().default(false),
  })
  .strict();
const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export async function prepareReportEmail(
  account: CoachAccount,
  input: z.infer<typeof emailSelection>,
) {
  const event = await loadReportEvent(account, input.eventId);
  const status = await getEventReports(account, event);
  const packet = status.entries.find(
    (e) => e.audience === input.audience && e.status === "ready",
  )?.packet;
  const report = packet?.reports.find((r) => r.key === input.reportKey);
  if (!packet || !report)
    throw new ReportError("Generate or select a saved report first.", 409);
  let recipients: { playerId: string; name: string; email: string }[] = [];
  let skipped: string[] = [];
  if (input.audience === "team") {
    const roster = await currentPlayerContacts(account.organizationId);
    skipped = roster.filter((p) => !p.email).map((p) => p.name);
    recipients = [
      ...new Map(
        roster
          .filter((p) => p.email)
          .map((p) => [
            p.email.toLowerCase(),
            { playerId: p.id, name: p.name, email: p.email },
          ]),
      ).values(),
    ];
  } else {
    if (!report.playerId)
      throw new ReportError(
        "This older report cannot be safely linked to a player. Download it and share it manually; automatic email is disabled.",
        409,
      );
    const contact = (await readPlayerContacts(account.organizationId)).find(
      (c) => c.player_id === report.playerId,
    );
    if (contact?.email && contact.player_name === report.title)
      recipients = [
        { playerId: report.playerId, name: report.title, email: contact.email },
      ];
    else skipped = [report.title];
  }
  const planToken = digest({
    eventId: event.id,
    packet: { ...packet, reports: [report] },
    recipients,
  });
  return {
    report,
    eventName: packet.eventName,
    preview: {
      planToken,
      recipients,
      skipped,
      configured: reportMailConfig().success,
      title: report.title,
    },
  };
}
export async function sendReportEmail(
  account: CoachAccount,
  input: z.infer<typeof emailRequest>,
) {
  const plan = await prepareReportEmail(account, input);
  if (plan.preview.planToken !== input.planToken)
    throw new ReportError(
      "The report or recipients changed. Review the recipient list again.",
      409,
    );
  if (!plan.preview.configured)
    throw new ReportError("Report email is not configured yet.", 503);
  if (!plan.preview.recipients.length)
    throw new ReportError("Add a player email in Team settings first.", 409);
  const pdf = Buffer.from(
    (await buildReportPDF(plan.report, plan.eventName)).output("arraybuffer"),
  );
  const db = createAdminSupabaseClient();
  const results: { name: string; email: string; status: string }[] = [];
  for (const recipient of plan.preview.recipients) {
    const key = digest({
      eventId: input.eventId,
      audience: input.audience,
      report: plan.report,
      to: recipient.email.toLowerCase(),
    });
    const args = {
      p_actor: account.userId,
      p_org: account.organizationId,
      p_event: input.eventId,
      p_key: key,
      p_lease: randomUUID(),
    };
    const claim = await db.rpc("claim_report_email", {
      ...args,
      p_resend: input.resend,
    });
    if (claim.error)
      throw new ReportError(
        "Email delivery tracking is unavailable. No further messages were sent.",
        503,
      );
    if (claim.data !== "claimed") {
      results.push({ ...recipient, status: String(claim.data) });
      continue;
    }
    const delivery = await deliverReportEmail({
      to: recipient.email,
      title: plan.report.title,
      eventName: plan.eventName,
      pdf,
    });
    const saved = await db.rpc("finish_report_email", {
      ...args,
      p_status: delivery,
    });
    results.push({
      ...recipient,
      status: saved.error || !saved.data ? "unknown" : delivery,
    });
  }
  return { results };
}
