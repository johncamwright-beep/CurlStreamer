import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import {
  m4DesktopEnabled,
  type M4DesktopCredential,
} from "./m4-desktop-authority";
import {
  observeM4YouTubeProvider,
  m4ProviderObservationSchema,
} from "./m4-provider-observation";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { refreshYouTubeAccessToken } from "./youtube";

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
export const m4DesktopObservationResultSchema =
  m4ProviderObservationSchema.safeExtend({
    intentId: id,
    sessionId: id,
    generation,
  });

export function m4DesktopObservationEnabled() {
  return m4DesktopEnabled() && process.env.CURLCAST_M4_TARGET_HANDOFF === "1";
}

/** Read-only confirmation. It neither consumes an intent nor extends a desktop lease. */
export async function observeM4DesktopOutput(
  gameId: string,
  credential: M4DesktopCredential,
  intentId: string,
) {
  try {
    if (!m4DesktopObservationEnabled()) throw new Error();
    id.parse(gameId);
    id.parse(intentId);
    const parsed = authority.parse(credential);
    const parameters = {
      p_game_id: gameId,
      p_session_id: parsed.sessionId,
      p_generation: parsed.generation,
      p_bearer_hash: createHash("sha256").update(parsed.bearer).digest("hex"),
      p_intent_id: intentId,
    };
    async function read() {
      const { data, error } = await createAdminSupabaseClient().rpc(
        "assert_m4_output_delivery",
        parameters,
      );
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
    const initial = await read();
    const accessToken = await refreshYouTubeAccessToken(
      decryptYouTubeRefreshToken(
        initial.encrypted_credentials,
        initial.organization_id,
      ),
    );
    const observation = await observeM4YouTubeProvider(accessToken, {
      channelId: initial.youtube_channel_id,
      streamId: initial.youtube_stream_id,
      broadcastId: initial.youtube_broadcast_id,
    });
    const current = await read();
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
      "lease_expires_at",
    ] as const)
      if (current[key] !== initial[key]) throw new Error();
    if (!m4DesktopObservationEnabled()) throw new Error();
    if (observation.broadcastLive) {
      const { error } = await createAdminSupabaseClient().rpc(
        "record_m4_live_evidence",
        {
          p_game_id: gameId,
          p_generation: current.broadcast_generation,
          p_broadcast_id: current.youtube_broadcast_id,
          p_stream_id: current.youtube_stream_id,
        },
      );
      if (error) throw new Error("live_evidence_unavailable");
    }
    return m4DesktopObservationResultSchema.parse({
      intentId,
      sessionId: current.session_id,
      generation: current.generation,
      ...observation,
    });
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    throw Object.assign(
      new Error("m4_desktop_observation_unavailable"),
      code === "42501" || code === "55000" ? { code } : {},
    );
  }
}
