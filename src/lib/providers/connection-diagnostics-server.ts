import "server-only";
import { randomUUID } from "node:crypto";
import { connectionDiagnosticSchema } from "./connection-diagnostics";

/** Correlates a phone/Studio request with hosting logs without recording input. */
export async function traceStudioRequest(
  handle: () => Promise<Response>,
  layer: "session" | "http" | "youtube" = "http",
) {
  const trace = randomUUID();
  const start = performance.now();
  const response = await handle();
  response.headers.set("x-curlstreamer-trace", trace);
  const durationMs = Math.min(600_000, Math.round(performance.now() - start));
  if (response.status >= 400 || durationMs >= 1500) {
    let code: unknown =
      response.status >= 500
        ? "network_unavailable"
        : response.status === 400 || response.status === 413
          ? "invalid_request"
          : response.status >= 400
            ? "authority_rejected"
            : "slow";
    if (response.status >= 400) {
      const value = await response
        .clone()
        .json()
        .catch(() => null);
      if (
        [
          "studio_stale",
          "peer_stale",
          "camera_released",
          "signal_limit",
          "studio_recovery_pending",
          "subscription_required",
        ].includes(value?.code)
      )
        code = value.code;
    }
    const row = connectionDiagnosticSchema.safeParse({
      at: new Date().toISOString(),
      run: trace,
      source: "server",
      layer,
      code,
      status: response.status,
      durationMs,
      trace,
      ...(response.headers.get("x-curlstreamer-stage")
        ? { stage: response.headers.get("x-curlstreamer-stage") }
        : {}),
    });
    if (row.success) {
      try {
        console.info("CurlStreamer connection", row.data);
      } catch {
        /* Logging cannot change a connection response. */
      }
    }
  }
  return response;
}
