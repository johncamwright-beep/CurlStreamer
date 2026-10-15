import "server-only";

import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";

const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const resourceSchema = z.object({ id: idSchema });
const paginationSchema = {
  nextPageToken: z.never().optional(),
  prevPageToken: z.never().optional(),
};
const resourcesSchema = z.object({
  items: z.array(resourceSchema).max(1),
  ...paginationSchema,
});
const broadcastsSchema = z.object({
  items: z
    .array(
      z.object({
        id: idSchema,
        status: z.object({ lifeCycleStatus: z.literal("complete") }),
      }),
    )
    .max(1),
  ...paginationSchema,
});
const retirementSchema = z.object({
  broadcastId: idSchema.optional(),
  streamId: idSchema.optional(),
  channelId: idSchema,
});

/** Independent provider evidence only; never deletes, starts, or reads ingest credentials. */
export async function verifyM4ProviderRetirement(
  accessToken: string,
  resources: { broadcastId?: string; streamId?: string; channelId: string },
  fetcher: typeof fetch = fetch,
): Promise<void> {
  try {
    const expected = retirementSchema.parse(resources);
    const read = (endpoint: string, parameters: Record<string, string>) => {
      const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
      url.search = new URLSearchParams(parameters).toString();
      return youtubeGoogleRequest(
        url.toString(),
        {
          method: "GET",
          headers: { authorization: `Bearer ${accessToken}` },
        },
        fetcher,
        true,
      );
    };
    // An empty resource list is meaningful only for the original channel owner.
    const channels = resourcesSchema.parse(
      await read("channels", {
        part: "id",
        mine: "true",
        fields: "items(id),nextPageToken,prevPageToken",
      }),
    );
    if (
      channels.items.length !== 1 ||
      channels.items[0].id !== expected.channelId
    )
      throw new Error();
    if (expected.streamId) {
      const streams = resourcesSchema.parse(
        await read("liveStreams", {
          part: "id",
          id: expected.streamId,
          fields: "items(id),nextPageToken,prevPageToken",
        }),
      );
      // Even an inactive stream retains a reusable target and cannot be retired.
      if (streams.items.length !== 0) throw new Error();
    }
    if (expected.broadcastId) {
      const broadcasts = broadcastsSchema.parse(
        await read("liveBroadcasts", {
          part: "id,status",
          id: expected.broadcastId,
          fields:
            "items(id,status(lifeCycleStatus)),nextPageToken,prevPageToken",
        }),
      );
      if (
        broadcasts.items.length !== 0 &&
        broadcasts.items[0].id !== expected.broadcastId
      )
        throw new Error();
    }
  } catch {
    // Includes 404, missing fields and transport uncertainty; none proves retirement.
    throw new Error("m4_retirement_unconfirmed");
  }
}
