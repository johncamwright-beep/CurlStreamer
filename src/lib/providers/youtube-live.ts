import "server-only";

import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";

const API = "https://www.googleapis.com/youtube/v3";

const broadcastSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({ description: z.string().optional() }),
  status: z.object({ lifeCycleStatus: z.string() }).optional(),
});
const streamSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({ description: z.string().optional() }),
  cdn: z.object({
    ingestionInfo: z.object({
      ingestionAddress: z.string().url(),
      streamName: z.string().min(1),
    }),
  }),
  status: z.object({ streamStatus: z.string() }).optional(),
});

async function youtubeRequest(
  path: string,
  accessToken: string,
  init: RequestInit = {},
  fetcher: typeof fetch = fetch,
) {
  return youtubeGoogleRequest(
    `${API}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    },
    fetcher,
    true,
  );
}

function marker(sessionKey: string) {
  return `CurlCast broadcast session ${sessionKey}`;
}

async function pagedItems<T>(
  path: string,
  accessToken: string,
  schema: z.ZodType<T>,
  fetcher: typeof fetch,
) {
  const items: T[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const suffix = pageToken
      ? `&pageToken=${encodeURIComponent(pageToken)}`
      : "";
    const value = z
      .object({ items: z.array(schema), nextPageToken: z.string().optional() })
      .parse(
        await youtubeRequest(`${path}${suffix}`, accessToken, {}, fetcher),
      );
    items.push(...value.items);
    if (!value.nextPageToken) return items;
    pageToken = value.nextPageToken;
  }
  throw new Error("broadcast_discovery_incomplete");
}

export async function findYouTubeBroadcast(
  accessToken: string,
  sessionKey: string,
  fetcher: typeof fetch = fetch,
) {
  const description = marker(sessionKey);
  return (
    await pagedItems(
      "/liveBroadcasts?part=id,snippet,status&broadcastStatus=all&maxResults=50",
      accessToken,
      broadcastSchema,
      fetcher,
    )
  ).find((item) => item.snippet.description === description);
}

export async function findYouTubeStream(
  accessToken: string,
  sessionKey: string,
  fetcher: typeof fetch = fetch,
) {
  const description = marker(sessionKey);
  return (
    await pagedItems(
      "/liveStreams?part=id,snippet,cdn,status&mine=true&maxResults=50",
      accessToken,
      streamSchema,
      fetcher,
    )
  ).find((item) => item.snippet.description === description);
}

export type YouTubeBroadcast = {
  id: string;
  watchUrl: string;
  lifeCycleStatus?: string;
};

export async function findOrCreateYouTubeBroadcast(
  values: {
    accessToken: string;
    sessionKey: string;
    title: string;
    visibility: "private" | "unlisted" | "public";
  },
  fetcher: typeof fetch = fetch,
  allowCreate = true,
): Promise<YouTubeBroadcast> {
  const description = marker(values.sessionKey);
  const existing = await findYouTubeBroadcast(
    values.accessToken,
    values.sessionKey,
    fetcher,
  );
  if (!existing && !allowCreate)
    throw new Error("broadcast_operation_uncertain");
  const value =
    existing ??
    broadcastSchema.parse(
      await youtubeRequest(
        "/liveBroadcasts?part=id,snippet,status,contentDetails",
        values.accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            snippet: {
              title: values.title,
              description,
              scheduledStartTime: new Date(Date.now() + 10_000).toISOString(),
            },
            status: { privacyStatus: values.visibility },
            contentDetails: {
              enableAutoStart: true,
              enableAutoStop: true,
              monitorStream: { enableMonitorStream: false },
              recordFromStart: true,
            },
          }),
        },
        fetcher,
      ),
    );
  return {
    id: value.id,
    watchUrl: `https://www.youtube.com/watch?v=${value.id}`,
    lifeCycleStatus: value.status?.lifeCycleStatus,
  };
}

export async function findOrCreateYouTubeStream(
  values: { accessToken: string; sessionKey: string; title: string },
  fetcher: typeof fetch = fetch,
  allowCreate = true,
) {
  const description = marker(values.sessionKey);
  const existing = await findYouTubeStream(
    values.accessToken,
    values.sessionKey,
    fetcher,
  );
  if (!existing && !allowCreate)
    throw new Error("broadcast_operation_uncertain");
  const value =
    existing ??
    streamSchema.parse(
      await youtubeRequest(
        "/liveStreams?part=id,snippet,cdn,status",
        values.accessToken,
        {
          method: "POST",
          body: JSON.stringify({
            snippet: { title: values.title, description },
            cdn: {
              ingestionType: "rtmp",
              resolution: "variable",
              frameRate: "variable",
            },
          }),
        },
        fetcher,
      ),
    );
  return {
    id: value.id,
    rtmpUrl: `${value.cdn.ingestionInfo.ingestionAddress}/${value.cdn.ingestionInfo.streamName}`,
    streamStatus: value.status?.streamStatus,
  };
}

export async function bindYouTubeBroadcast(
  accessToken: string,
  broadcastId: string,
  streamId: string,
  fetcher: typeof fetch = fetch,
) {
  await youtubeRequest(
    `/liveBroadcasts/bind?part=id,status&id=${encodeURIComponent(broadcastId)}&streamId=${encodeURIComponent(streamId)}`,
    accessToken,
    { method: "POST" },
    fetcher,
  );
}

export async function getYouTubeStreamStatus(
  accessToken: string,
  streamId: string,
  fetcher: typeof fetch = fetch,
) {
  const value = z
    .object({ items: z.array(streamSchema) })
    .parse(
      await youtubeRequest(
        `/liveStreams?part=id,snippet,cdn,status&id=${encodeURIComponent(streamId)}`,
        accessToken,
        {},
        fetcher,
      ),
    );
  return value.items[0]?.status?.streamStatus ?? "missing";
}

export async function transitionYouTubeBroadcast(
  accessToken: string,
  broadcastId: string,
  status: "live" | "complete",
  fetcher: typeof fetch = fetch,
) {
  await youtubeRequest(
    `/liveBroadcasts/transition?part=id,status&id=${encodeURIComponent(broadcastId)}&broadcastStatus=${status}`,
    accessToken,
    { method: "POST" },
    fetcher,
  );
}

export async function getYouTubeBroadcastStatus(
  accessToken: string,
  broadcastId: string,
  fetcher: typeof fetch = fetch,
) {
  const value = z
    .object({ items: z.array(broadcastSchema) })
    .parse(
      await youtubeRequest(
        `/liveBroadcasts?part=id,snippet,status&id=${encodeURIComponent(broadcastId)}`,
        accessToken,
        {},
        fetcher,
      ),
    );
  return value.items[0]?.status?.lifeCycleStatus ?? "missing";
}

export async function finishYouTubeBroadcast(
  accessToken: string,
  broadcastId: string,
  fetcher: typeof fetch = fetch,
) {
  const status = await getYouTubeBroadcastStatus(
    accessToken,
    broadcastId,
    fetcher,
  );
  if (status === "complete" || status === "missing") return;
  if (["live", "testing"].includes(status)) {
    try {
      await transitionYouTubeBroadcast(
        accessToken,
        broadcastId,
        "complete",
        fetcher,
      );
    } catch (error) {
      if (
        (await getYouTubeBroadcastStatus(accessToken, broadcastId, fetcher)) !==
        "complete"
      )
        throw error;
    }
    return;
  }
  // An interrupted start has no replay to preserve. Delete its private
  // scheduled resource instead of pretending that it completed.
  if (["created", "ready"].includes(status)) {
    await youtubeRequest(
      `/liveBroadcasts?id=${encodeURIComponent(broadcastId)}`,
      accessToken,
      { method: "DELETE" },
      fetcher,
    );
    return;
  }
  throw new Error("youtube_broadcast_stop_pending");
}

export async function deleteYouTubeStream(
  accessToken: string,
  streamId: string | undefined,
  fetcher: typeof fetch = fetch,
) {
  if (!streamId) return;
  await youtubeRequest(
    `/liveStreams?id=${encodeURIComponent(streamId)}`,
    accessToken,
    { method: "DELETE" },
    fetcher,
  );
}
