import "server-only";

import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";

// Provider schema: https://developers.google.com/youtube/v3/live/docs/liveStreams
// TLS/port: https://developers.google.com/youtube/v3/live/guides/rtmps-ingestion
// Primary endpoint: obsproject/obs-studio plugins/rtmp-services/data/services.json.
// Deliberately support only the primary endpoint, without URL repair or RTMP fallback.
const primaryAddress = /^rtmps:\/\/a\.rtmps\.youtube\.com(?::443)?\/live2$/;
const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const listSchema = z.object({
  items: z.array(z.object({ id: idSchema }).passthrough()).max(1),
});
const targetSchema = z.object({
  cdn: z.object({
    ingestionType: z.literal("rtmp"), // YouTube uses this value for RTMPS too.
    ingestionInfo: z.object({
      rtmpsIngestionAddress: z.string().regex(primaryAddress),
      streamName: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    }),
  }),
});
const statusSchema = z.object({
  status: z.object({
    streamStatus: z.enum(["active", "created", "error", "inactive", "ready"]),
    healthStatus: z
      .object({ status: z.enum(["good", "ok", "bad", "noData"]) })
      .optional(),
  }),
});

/** Sensitive, server-memory-only value; never serialize into a browser response or log. */
export interface YouTubeIngestTarget {
  serverUrl: "rtmps://a.rtmps.youtube.com:443/live2";
  streamKey: string;
}

export interface YouTubeIngestObservation {
  streamStatus:
    "active" | "created" | "error" | "inactive" | "ready" | "missing";
  healthStatus: "good" | "ok" | "bad" | "noData" | null;
}

async function readStream(
  accessToken: string,
  streamId: string,
  part: "cdn" | "status",
  fetcher: typeof fetch,
) {
  if (!idSchema.safeParse(streamId).success) {
    throw new Error("youtube_ingest_invalid_stream_id");
  }
  const value = await youtubeGoogleRequest(
    `https://www.googleapis.com/youtube/v3/liveStreams?part=id,${part}&id=${encodeURIComponent(streamId)}`,
    { method: "GET", headers: { authorization: `Bearer ${accessToken}` } },
    fetcher,
    true,
  );
  const parsed = listSchema.safeParse(value);
  if (!parsed.success) throw new Error("youtube_ingest_response_invalid");
  const stream = parsed.data.items[0];
  if (stream && stream.id !== streamId) {
    throw new Error("youtube_ingest_response_invalid");
  }
  return stream;
}

/** Reads credentials only; does not start an encoder or transition a broadcast. */
export async function getYouTubeIngestTarget(
  accessToken: string,
  streamId: string,
  fetcher: typeof fetch = fetch,
): Promise<YouTubeIngestTarget> {
  const stream = await readStream(accessToken, streamId, "cdn", fetcher);
  if (!stream) throw new Error("youtube_ingest_stream_missing");
  const parsed = targetSchema.safeParse(stream);
  if (!parsed.success) throw new Error("youtube_ingest_destination_invalid");
  return {
    serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
    streamKey: parsed.data.cdn.ingestionInfo.streamName,
  };
}

/** Independent provider observation, not inferred from OBS or broadcast lifecycle. */
export async function observeYouTubeIngest(
  accessToken: string,
  streamId: string,
  fetcher: typeof fetch = fetch,
): Promise<YouTubeIngestObservation> {
  const stream = await readStream(accessToken, streamId, "status", fetcher);
  if (!stream) return { streamStatus: "missing", healthStatus: null };
  const parsed = statusSchema.safeParse(stream);
  if (!parsed.success) throw new Error("youtube_ingest_response_invalid");
  return {
    streamStatus: parsed.data.status.streamStatus,
    healthStatus: parsed.data.status.healthStatus?.status ?? null,
  };
}
