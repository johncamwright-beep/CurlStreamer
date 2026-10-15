import "server-only";
import { createHmac } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Shared atomic counters across all server instances. No fail-open fallback. */
export async function rateLimit(key: string, limit = 30, windowMs = 60_000) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (
    !secret ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 1000 ||
    !Number.isInteger(windowMs) ||
    windowMs < 1000 ||
    windowMs > 3_600_000
  )
    throw new Error("Rate limiter unavailable");
  const fingerprint = createHmac("sha256", secret).update(key).digest("hex");
  const { data, error } = await createAdminSupabaseClient().rpc(
    "consume_request_limit",
    {
      p_fingerprint: fingerprint,
      p_limit: limit,
      p_window_ms: windowMs,
    },
  );
  if (error || typeof data !== "boolean")
    throw new Error("Rate limiter unavailable");
  return data;
}
