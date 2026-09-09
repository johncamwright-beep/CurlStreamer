import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  m4DesktopEnabled,
  type M4DesktopCredential,
} from "./m4-desktop-authority";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { refreshYouTubeAccessToken } from "./youtube";
import { getYouTubeIngestTarget } from "./youtube-ingest";

const id = z.uuid();
const generation = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const instant = z.iso.datetime({ offset: true });
const providerId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const authority = z
  .object({
    sessionId: id,
    generation,
    bearer: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
const metadata = z.object({
  intent_id: id,
  session_id: id,
  generation: z.coerce.number().pipe(generation),
  organization_id: id,
  encrypted_credentials: z.string().min(1),
  broadcast_generation: z.coerce.number().pipe(generation),
  youtube_broadcast_id: providerId,
  youtube_stream_id: providerId,
  youtube_channel_id: providerId,
  youtube_connection_version: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  expires_at: instant,
  lease_expires_at: instant,
});
export const m4TargetResultSchema = z.object({
  intentId: id,
  sessionId: id,
  generation,
  expiresAt: instant,
  leaseExpiresAt: instant,
  target: z.object({
    serverUrl: z.literal("rtmps://a.rtmps.youtube.com:443/live2"),
    streamKey: z.string().regex(/^[A-Za-z0-9_-]{1,255}$/),
  }),
});
export function m4TargetHandoffEnabled() {
  return m4DesktopEnabled() && process.env.CURLCAST_M4_TARGET_HANDOFF === "1";
}

/** Once-only sensitive desktop response. Any uncertainty burns the intent; never retry delivery. */
export async function deliverM4Target(
  gameId: string,
  credential: M4DesktopCredential,
  intentId: string,
) {
  try {
    if (!m4TargetHandoffEnabled()) throw new Error();
    id.parse(gameId);
    id.parse(intentId);
    const parsed = authority.parse(credential);
    const admin = createAdminSupabaseClient();
    const parameters = {
      p_game_id: gameId,
      p_session_id: parsed.sessionId,
      p_generation: parsed.generation,
      p_bearer_hash: createHash("sha256").update(parsed.bearer).digest("hex"),
      p_intent_id: intentId,
    };
    async function read(name: string) {
      const { data, error } = await admin.rpc(name, parameters);
      if (error) throw Object.assign(new Error(), { code: error.code });
      const value = z.array(metadata).length(1).parse(data)[0];
      if (
        value.intent_id !== intentId ||
        value.session_id !== parsed.sessionId ||
        value.generation !== parsed.generation ||
        Date.parse(value.expires_at) <= Date.now() ||
        Date.parse(value.lease_expires_at) <= Date.now()
      )
        throw new Error();
      return value;
    }
    // Consuming commits sticky quarantine before decrypting provider credentials.
    const consumed = await read("consume_m4_output_delivery");
    const token = await refreshYouTubeAccessToken(
      decryptYouTubeRefreshToken(
        consumed.encrypted_credentials,
        consumed.organization_id,
      ),
    );
    const target = await getYouTubeIngestTarget(
      token,
      consumed.youtube_stream_id,
    );
    // Slow network work may outlive stop, account removal, channel replacement or lease.
    const current = await read("assert_m4_output_delivery");
    for (const key of [
      "intent_id",
      "session_id",
      "generation",
      "organization_id",
      "encrypted_credentials",
      "broadcast_generation",
      "youtube_broadcast_id",
      "youtube_stream_id",
      "youtube_channel_id",
      "youtube_connection_version",
      "expires_at",
    ] as const) {
      if (current[key] !== consumed[key]) throw new Error();
    }
    if (!m4TargetHandoffEnabled()) throw new Error();
    return m4TargetResultSchema.parse({
      intentId,
      sessionId: current.session_id,
      generation: current.generation,
      expiresAt: current.expires_at,
      leaseExpiresAt: current.lease_expires_at,
      target,
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw Object.assign(
      new Error("m4_target_delivery_unavailable"),
      code === "42501" || code === "55000" ? { code } : {},
    );
  }
}
