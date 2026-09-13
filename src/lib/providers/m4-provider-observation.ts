import "server-only";

import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";

// Google reference: https://developers.google.com/youtube/v3/live/docs/liveStreams/list
// Google reference: https://developers.google.com/youtube/v3/live/docs/liveBroadcasts/list
const API = "https://www.googleapis.com/youtube/v3";
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const streamStatus = z.enum([
  "active",
  "created",
  "error",
  "inactive",
  "ready",
]);
const healthStatus = z.enum(["good", "ok", "bad", "noData"]);
const broadcastStatus = z.enum([
  "complete",
  "created",
  "live",
  "ready",
  "revoked",
  "testStarting",
  "testing",
  "liveStarting",
]);

const listEnvelope = z.object({
  nextPageToken: z.never().optional(),
  prevPageToken: z.never().optional(),
});
const ownedChannelSchema = listEnvelope.extend({
  items: z.array(z.object({ id })).length(1),
});
const streamSchema = listEnvelope.extend({
  items: z
    .array(
      z.object({
        id,
        snippet: z.object({ channelId: id }),
        status: z.object({
          streamStatus,
          healthStatus: z.object({ status: healthStatus }).optional(),
        }),
      }),
    )
    .max(1),
});
const broadcastSchema = listEnvelope.extend({
  items: z
    .array(
      z.object({
        id,
        snippet: z.object({ channelId: id }),
        status: z.object({
          lifeCycleStatus: broadcastStatus,
          privacyStatus: z.literal("unlisted"),
        }),
        contentDetails: z.object({
          boundStreamId: id,
          enableAutoStart: z.literal(false),
          enableAutoStop: z.literal(false),
        }),
      }),
    )
    .max(1),
});

export const m4ProviderObservationSchema = z
  .object({
    streamStatus: streamStatus.or(z.literal("missing")),
    healthStatus: healthStatus.nullable(),
    broadcastStatus,
    broadcastLive: z.boolean(),
  })
  .refine(
    (value) => value.broadcastLive === (value.broadcastStatus === "live"),
  );
export type M4ProviderObservation = z.infer<typeof m4ProviderObservationSchema>;

function get(path: string, accessToken: string, fetcher: typeof fetch) {
  return youtubeGoogleRequest(
    `${API}${path}`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
    fetcher,
    true,
  );
}

/**
 * Read-only YouTube confirmation for a previously delivered desktop intent.
 * It cannot retrieve a CDN target or transition the broadcast lifecycle.
 */
export async function observeM4YouTubeProvider(
  accessToken: string,
  expected: { channelId: string; streamId: string; broadcastId: string },
  fetcher: typeof fetch = fetch,
): Promise<M4ProviderObservation> {
  try {
    const ids = z
      .object({ channelId: id, streamId: id, broadcastId: id })
      .parse(expected);
    const owned = ownedChannelSchema.parse(
      await get("/channels?part=id&mine=true", accessToken, fetcher),
    );
    if (owned.items[0].id !== ids.channelId) throw new Error();

    const stream = streamSchema.parse(
      await get(
        `/liveStreams?part=id,snippet,status&id=${encodeURIComponent(ids.streamId)}`,
        accessToken,
        fetcher,
      ),
    ).items[0];
    if (
      !stream ||
      stream.id !== ids.streamId ||
      stream.snippet.channelId !== ids.channelId
    )
      throw new Error();

    const broadcast = broadcastSchema.parse(
      await get(
        `/liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(ids.broadcastId)}`,
        accessToken,
        fetcher,
      ),
    ).items[0];
    if (
      !broadcast ||
      broadcast.id !== ids.broadcastId ||
      broadcast.snippet.channelId !== ids.channelId ||
      broadcast.contentDetails.boundStreamId !== ids.streamId
    )
      throw new Error();

    return m4ProviderObservationSchema.parse({
      streamStatus: stream.status.streamStatus,
      healthStatus: stream.status.healthStatus?.status ?? null,
      broadcastStatus: broadcast.status.lifeCycleStatus,
      broadcastLive: broadcast.status.lifeCycleStatus === "live",
    });
  } catch {
    throw new Error("m4_provider_observation_unavailable");
  }
}
