import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
import type { CoachEvent } from "@/lib/curlcoach/event";
import {
  REPORT_POLICY,
  eventReportEligibility,
  reportInputs,
  reportPlayers,
  type ReportAudience,
  type ReportPacket,
  type ReportStatus,
} from "@/lib/curlcoach/reports";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadProductionStreamerEvent } from "./curlcoach-production-streamer";
import { loadCoachState } from "./curlcoach-store";
import {
  generateShotTrackerNarrative,
  reportAIConfig,
} from "./shot-tracker-ai";

export async function loadReportEvent(account: CoachAccount, eventId: string) {
  const { event } = await loadProductionStreamerEvent(
    eventId,
    undefined,
    undefined,
    account,
  );
  if (event.id !== eventId || event.organizationId !== account.organizationId)
    throw new Error("Event unavailable");
  event.games.sort(
    (a, b) =>
      (a.scheduledStart ?? "").localeCompare(b.scheduledStart ?? "") ||
      a.id.localeCompare(b.id),
  );
  for (const game of event.games)
    game.state = await loadCoachState(
      {
        organizationId: account.organizationId,
        actorUserId: account.userId,
        gameId: game.id,
      },
      game.state,
    );
  return event;
}
export function reportFingerprint(event: CoachEvent, audience: ReportAudience) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        policy: REPORT_POLICY,
        model: process.env.SHOT_TRACKER_AI_MODEL ?? "",
        audience,
        event: {
          id: event.id,
          name: event.name,
          games: event.games.map((g) => ({
            id: g.id,
            status: g.status,
            ends: g.ends,
            available: g.scoreboardAvailable,
            hammer: g.initialHammer,
            state: g.state,
          })),
        },
      }),
    )
    .digest("hex");
}
async function rpc(
  name: string,
  account: CoachAccount,
  eventId: string,
  extra: Record<string, unknown> = {},
) {
  const { data, error } = await createAdminSupabaseClient().rpc(name, {
    p_actor: account.userId,
    p_org: account.organizationId,
    p_event: eventId,
    ...extra,
  });
  if (error) throw new Error("Private report storage unavailable");
  return data;
}
export async function getEventReports(
  account: CoachAccount,
  event: CoachEvent,
): Promise<ReportStatus> {
  const rows = z
    .array(
      z.object({
        audience: z.enum(["coach", "team", "players"]),
        fingerprint: z.string(),
        status: z.enum(["ready", "processing", "failed"]),
        updated_at: z.string(),
        packet: z.unknown(),
      }),
    )
    .parse(await rpc("read_shot_tracker_reports", account, event.id));
  return {
    configured: !!reportAIConfig(),
    eligible: !eventReportEligibility(event),
    reason: eventReportEligibility(event),
    entries: rows.map((r) => ({
      audience: r.audience,
      status:
        r.status === "processing" &&
        Date.parse(r.updated_at) < Date.now() - 180_000
          ? "failed"
          : r.status,
      stale: r.fingerprint !== reportFingerprint(event, r.audience),
      packet: r.status === "ready" ? (r.packet as ReportPacket) : null,
    })),
  };
}
export class ReportError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function generateEventReports(
  account: CoachAccount,
  event: CoachEvent,
  audience: ReportAudience,
) {
  const reason = eventReportEligibility(event);
  if (reason) throw new ReportError(reason, 409);
  if (!reportAIConfig())
    throw new ReportError("AI reports are not configured yet.", 503);
  const inputs = reportInputs(event, audience);
  if (!inputs.length || inputs.length > 8)
    throw new ReportError(
      "Reports support up to eight recorded players per event.",
      422,
    );
  const fingerprint = reportFingerprint(event, audience),
    lease = randomUUID();
  const args = {
    p_audience: audience,
    p_fingerprint: fingerprint,
    p_lease: lease,
  };
  const claim = (await rpc(
    "claim_shot_tracker_report",
    account,
    event.id,
    args,
  )) as { status: string; packet?: ReportPacket };
  if (claim.status === "ready") return claim.packet!;
  if (claim.status !== "claimed")
    throw new ReportError(
      claim.status === "limit"
        ? "The team's daily report allowance is reached. Try again tomorrow."
        : claim.status === "cooldown"
          ? "Please wait three minutes before retrying this report."
          : "A team report is already being generated. Check again shortly.",
      429,
    );
  const abort = new AbortController();
  const deadline = setTimeout(() => abort.abort(), 110_000);
  try {
    const names = reportPlayers(event).flatMap((p) => [
      p.name,
      ...p.name.split(/\s+/),
    ]);
    const signal = abort.signal;
    const packet: ReportPacket = {
      eventName: event.name,
      audience,
      policy: REPORT_POLICY,
      generatedAt: new Date().toISOString(),
      reports: [],
    };
    // Two bounded workers keep a one-touch player packet within the request deadline.
    let next = 0;
    await Promise.all(
      Array.from({ length: Math.min(2, inputs.length) }, async () => {
        while (next < inputs.length) {
          const index = next++;
          const input = inputs[index];
          const narrative = await generateShotTrackerNarrative(
            input,
            audience,
            names,
            signal,
          );
          packet.reports[index] = { ...input, narrative };
        }
      }),
    );
    // Refuse to publish if results, grades, roster, membership or completion changed mid-generation.
    const fresh = await loadReportEvent(account, event.id);
    if (
      eventReportEligibility(fresh) ||
      reportFingerprint(fresh, audience) !== fingerprint
    )
      throw new ReportError(
        "Event data changed. Refresh before generating the report again.",
        409,
      );
    if (audience === "coach") {
      const players = reportPlayers(event);
      for (const entry of packet.reports[0].evidence)
        if (entry.id.startsWith("player-"))
          entry.label += ` · ${players[Number(entry.id.slice(7)) - 1]?.name ?? ""}`;
    }
    if (
      !(await rpc("finish_shot_tracker_report", account, event.id, {
        ...args,
        p_packet: packet,
      }))
    )
      throw new Error("Report lease expired");
    return packet;
  } catch (error) {
    abort.abort();
    const reasons = [
      "Report provider unavailable",
      "Report generation incomplete",
      "Report generation unavailable",
      "Invalid report prose",
      "Unknown evidence",
      "Private identity in report",
      "Individual commentary in team report",
      "Incorrect product name",
      "Report lease expired",
      "Private report storage unavailable",
    ];
    console.error("Shot Tracker report failed", {
      reason:
        error instanceof Error && reasons.includes(error.message)
          ? error.message
          : "validation_or_service_failure",
    });
    await rpc("finish_shot_tracker_report", account, event.id, {
      ...args,
      p_packet: null,
    }).catch(() => undefined);
    if (error instanceof ReportError) throw error;
    throw new ReportError(
      "The report could not be validated or saved. Your event data is safe; retry shortly.",
      503,
    );
  } finally {
    clearTimeout(deadline);
  }
}
