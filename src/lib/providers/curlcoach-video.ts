import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { refreshYouTubeAccessToken, youtubeGoogleRequest } from "./youtube";
import type { BroadcastReview } from "@/lib/curlcoach/review";

const sessionsSchema = z.array(
  z.object({
    game_id: z.uuid(),
    youtube_broadcast_id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{11}$/)
      .nullable(),
  }),
);
const videosSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      liveStreamingDetails: z
        .object({
          actualStartTime: z.string().datetime().optional(),
          actualEndTime: z.string().datetime().optional(),
        })
        .optional(),
    }),
  ),
});
// Only non-secret timing metadata is cached. Organization prevents cross-team reuse.
const cache = new Map<string, { until: number; value?: BroadcastReview }>();
/** Called only after coach authorization, with IDs from the account-scoped game listing. */
export async function loadCoachBroadcastReviews(
  organizationId: string,
  gameIds: string[],
): Promise<Record<string, BroadcastReview>> {
  const result: Record<string, BroadcastReview> = {};
  if (!gameIds.length) return result;
  try {
    const db = createAdminSupabaseClient();
    const rows = await db
      .from("broadcast_sessions")
      .select("game_id,youtube_broadcast_id")
      .eq("organization_id", organizationId)
      .eq("provider", "youtube")
      .in("game_id", gameIds);
    if (rows.error) return result;
    const sessions = sessionsSchema
      .parse(rows.data)
      .filter((s) => s.youtube_broadcast_id);
    const ids = [...new Set(sessions.map((s) => s.youtube_broadcast_id!))];
    const missing = ids.filter(
      (id) => (cache.get(organizationId + ":" + id)?.until ?? 0) <= Date.now(),
    );
    if (missing.length) {
      const credentials = await db
        .from("broadcast_settings")
        .select("encrypted_credentials")
        .eq("organization_id", organizationId)
        .eq("provider", "youtube")
        .single();
      if (
        credentials.error ||
        typeof credentials.data?.encrypted_credentials !== "string"
      )
        return result;
      const stored = credentials.data.encrypted_credentials;
      // PostgREST bytea uses a hex prefix; the vault accepts a base64 envelope.
      const envelope = stored.startsWith("\\x")
        ? Buffer.from(stored.slice(2), "hex").toString("base64")
        : stored;
      const accessToken = await refreshYouTubeAccessToken(
        decryptYouTubeRefreshToken(envelope, organizationId),
      );
      for (let offset = 0; offset < missing.length; offset += 50) {
        const batch = missing.slice(offset, offset + 50);
        const url = new URL("https://www.googleapis.com/youtube/v3/videos");
        url.search = new URLSearchParams({
          part: "liveStreamingDetails",
          id: batch.join(","),
        }).toString();
        const videos = videosSchema.parse(
          await youtubeGoogleRequest(
            url.toString(),
            { headers: { authorization: "Bearer " + accessToken } },
            fetch,
            true,
          ),
        );
        for (const id of batch) {
          const timing = videos.items.find(
            (v) => v.id === id,
          )?.liveStreamingDetails;
          const value = timing?.actualStartTime
            ? {
                url: "https://www.youtube.com/watch?v=" + id,
                startedAt: timing.actualStartTime,
                ...(timing.actualEndTime
                  ? { endedAt: timing.actualEndTime }
                  : {}),
              }
            : undefined;
          if (cache.size >= 500) cache.delete(cache.keys().next().value!);
          cache.set(organizationId + ":" + id, {
            until: Date.now() + 60_000,
            value,
          });
        }
      }
    }
    for (const session of sessions) {
      const value = cache.get(
        organizationId + ":" + session.youtube_broadcast_id,
      )?.value;
      if (value) result[session.game_id] = value;
    }
  } catch {
    // Video/provider outages must not prevent private scoring or expose credentials.
  }
  return result;
}
