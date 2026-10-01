// A fixed vocabulary, not an error-message logger. Never add URLs, credentials,
// SDP/ICE, device identifiers, raw stats, provider bodies or arbitrary strings.
import { z } from "zod";

export const connectionDiagnosticSchema = z
  .object({
    at: z.iso.datetime(),
    firstAt: z.iso.datetime().optional(),
    run: z.uuid(),
    source: z.enum(["phone", "studio", "renderer", "server"]),
    layer: z.enum([
      "page",
      "capture",
      "wake",
      "claim",
      "http",
      "realtime",
      "peer",
      "media",
      "session",
      "audio",
      "youtube",
    ]),
    code: z.enum([
      "started",
      "ready",
      "stopped",
      "retry",
      "recovered",
      "slow",
      "timeout",
      "network_unavailable",
      "authority_rejected",
      "lease_expired",
      "studio_stale",
      "peer_stale",
      "camera_released",
      "camera_page_replaced",
      "signal_limit",
      "permission_denied",
      "device_missing",
      "capture_failed",
      "wake_unavailable",
      "wake_acquired",
      "wake_unsupported",
      "wake_permission_denied",
      "wake_released",
      "audio_suspended",
      "invalid_request",
      "backgrounded",
      "visible",
      "channel_closed",
      "verification_failed",
      "verification_timeout",
      "transport_failed",
      "encoding_failed",
      "description_rejected",
      "confirmation_failed",
      "unknown_failure",
      "studio_recovery_pending",
      "subscription_required",
      "sample",
    ]),
    role: z.enum(["camera-home", "camera-away"]).optional(),
    stage: z
      .enum([
        "configuration",
        "database",
        "ticket",
        "broadcast",
        "authorization",
        "unexpected",
      ])
      .optional(),
    action: z
      .enum([
        "prepare",
        "exchange",
        "begin",
        "register",
        "check",
        "ticket",
        "signal",
        "stop",
        "read",
        "claim",
        "connect",
        "heartbeat",
        "output_intent",
        "target",
        "observe",
      ])
      .optional(),
    attempt: z.number().int().min(0).max(1_000_000).optional(),
    durationMs: z.number().int().min(0).max(600_000).optional(),
    status: z.number().int().min(100).max(599).optional(),
    trace: z.uuid().optional(),
    connection: z
      .enum([
        "new",
        "connecting",
        "connected",
        "disconnected",
        "failed",
        "closed",
      ])
      .optional(),
    ice: z
      .enum([
        "new",
        "checking",
        "connected",
        "completed",
        "disconnected",
        "failed",
        "closed",
      ])
      .optional(),
    direct: z.boolean().optional(),
    frames: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    count: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();
export type ConnectionDiagnosticRow = z.infer<
  typeof connectionDiagnosticSchema
>;
export type ConnectionDiagnosticInput = Omit<
  ConnectionDiagnosticRow,
  "at" | "run" | "source"
>;
export type ConnectionDiagnostic = (input: ConnectionDiagnosticInput) => void;

export function connectionFailureReason(
  reason: string,
): ConnectionDiagnosticInput["code"] {
  if (/authority expired/i.test(reason)) return "lease_expired";
  if (
    /authority expired|authority ended|authority or direct connection ended/i.test(
      reason,
    )
  )
    return "authority_rejected";
  if (/verification timed out|No verified direct path/i.test(reason))
    return "verification_timeout";
  if (
    /verification failed|path statistics|verify the media path|Path check stopped/i.test(
      reason,
    )
  )
    return "verification_failed";
  if (/signaling.*disconnect|Signaling stopped/i.test(reason))
    return "channel_closed";
  if (/transport failed|Direct connection failed/i.test(reason))
    return "transport_failed";
  if (/encoding settings/i.test(reason)) return "encoding_failed";
  if (/description.*validation|WebRTC could not apply/i.test(reason))
    return "description_rejected";
  if (/confirmation.*delivered/i.test(reason)) return "confirmation_failed";
  return "unknown_failure";
}

/** Bounded history with repeat coalescing. Logging failures cannot affect media. */
export function createConnectionDiagnostics(
  source: ConnectionDiagnosticRow["source"],
  run: string,
  persist: (rows: ConnectionDiagnosticRow[]) => void,
  initial: unknown = [],
) {
  let rows =
    z.array(connectionDiagnosticSchema).max(512).safeParse(initial).data ?? [];
  const record: ConnectionDiagnostic = (input) => {
    try {
      const row = connectionDiagnosticSchema.parse({
        ...input,
        at: new Date().toISOString(),
        run,
        source,
      });
      const identity = (value: ConnectionDiagnosticRow) => {
        const rest: Partial<ConnectionDiagnosticRow> = { ...value };
        delete rest.at;
        delete rest.firstAt;
        delete rest.durationMs;
        delete rest.count;
        delete rest.trace;
        return JSON.stringify(rest);
      };
      // Interleaved Camera 1/2 failures must not flood away the first cause.
      // Keep the latest correlation ID, original time and repeat count.
      const index = rows.findLastIndex(
        (previous) =>
          Date.parse(row.at) - Date.parse(previous.firstAt ?? previous.at) <
            15_000 && identity(row) === identity(previous),
      );
      const previous = rows[index];
      if (previous) {
        rows = [
          ...rows.filter((_row, i) => i !== index),
          {
            ...row,
            firstAt: previous.firstAt ?? previous.at,
            count: (previous.count ?? 1) + 1,
          },
        ];
      } else rows = [...rows.slice(-511), row];
      persist(rows);
    } catch {
      /* Fixed schema rejects unknown metadata. Logging is best effort. */
    }
  };
  return { record, snapshot: () => rows.map((row) => ({ ...row })) };
}

export function createPhoneConnectionDiagnostics(
  gameId: string,
  role: "camera-home" | "camera-away",
) {
  const key = `curlstreamer-connection-log:${gameId}:${role}`;
  let initial: unknown = [];
  try {
    const value = localStorage.getItem(key);
    if (value && value.length <= 262_144) initial = JSON.parse(value);
  } catch {
    /* Safari private/storage denial. */
  }
  return createConnectionDiagnostics(
    "phone",
    crypto.randomUUID(),
    (rows) => {
      try {
        localStorage.setItem(key, JSON.stringify(rows));
      } catch {
        /* Export remains available in memory. */
      }
    },
    initial,
  );
}
