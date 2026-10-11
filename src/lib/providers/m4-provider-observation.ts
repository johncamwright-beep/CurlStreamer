import "server-only";

import { z } from "zod";
import { youtubeGoogleRequest } from "./youtube";
import { m4YouTubeFailureCode } from "./m4-youtube-failure";

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
          privacyStatus: z.enum(["private", "unlisted", "public"]),
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
    concurrentViewers: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable()
      .optional(),
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

const ownershipScopeSchema = z.object({
  organizationId: z.uuid(),
  connectionVersion: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
  credentialDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type M4OwnershipVerificationScope = z.infer<typeof ownershipScopeSchema>;
const ownershipVerificationTtlMs = 5 * 60_000;
const ownershipVerificationLimit = 128;
const verifiedOwners = new Map<
  string,
  { verifiedAt?: number; flight?: Promise<void> }
>();

async function verifyOwnedChannel(
  accessToken: string,
  channelId: string,
  fetcher: typeof fetch,
  scope?: M4OwnershipVerificationScope,
) {
  const verify = async () => {
    const owned = ownedChannelSchema.parse(
      await get("/channels?part=id&mine=true", accessToken, fetcher),
    );
    if (owned.items[0].id !== channelId) throw new Error();
  };
  // Only the server's immutable connection binding may opt into this cache.
  // It stores no token or authority; every observation still checks its own
  // resources and desktop authority before returning provider evidence.
  if (!scope) return verify();
  const parsed = ownershipScopeSchema.parse(scope);
  const key = JSON.stringify([
    parsed.organizationId,
    parsed.connectionVersion,
    parsed.credentialDigest,
    channelId,
  ]);
  const cached = verifiedOwners.get(key);
  const age =
    cached?.verifiedAt === undefined ? -1 : Date.now() - cached.verifiedAt;
  if (age >= 0 && age < ownershipVerificationTtlMs) return;
  if (cached?.flight) return cached.flight;
  const entry: { verifiedAt?: number; flight?: Promise<void> } = {};
  verifiedOwners.delete(key);
  if (verifiedOwners.size >= ownershipVerificationLimit)
    verifiedOwners.delete(verifiedOwners.keys().next().value!);
  verifiedOwners.set(key, entry);
  entry.flight = verify()
    .then(() => {
      entry.verifiedAt = Date.now();
    })
    .catch((error) => {
      if (verifiedOwners.get(key) === entry) verifiedOwners.delete(key);
      throw error;
    })
    .finally(() => {
      entry.flight = undefined;
    });
  return entry.flight;
}

// Viewer counts are optional telemetry. Read only after verifying channel/resource
// ownership, and cache briefly to avoid adding a Google request to every poll.
const viewers = new Map<string, { at: number; count: number | null }>();
async function viewerCount(
  channelId: string,
  broadcastId: string,
  token: string,
  fetcher: typeof fetch,
) {
  const key = channelId + ":" + broadcastId;
  const cached = viewers.get(key);
  if (cached && Date.now() - cached.at < 60000) return cached.count;
  let count: number | null = null;
  try {
    const result = z
      .object({
        items: z
          .array(
            z.object({
              id,
              liveStreamingDetails: z
                .object({
                  concurrentViewers: z.string().regex(/^\d+$/).optional(),
                })
                .optional(),
            }),
          )
          .max(1),
      })
      .parse(
        await get(
          `/videos?part=liveStreamingDetails&id=${encodeURIComponent(broadcastId)}`,
          token,
          (url, init) =>
            fetcher(url, {
              ...init,
              signal: AbortSignal.any([
                init?.signal ?? AbortSignal.timeout(3000),
                AbortSignal.timeout(3000),
              ]),
            }),
        ),
      );
    const item = result.items[0];
    const value = item?.liveStreamingDetails?.concurrentViewers;
    if (
      item?.id === broadcastId &&
      value !== undefined &&
      Number.isSafeInteger(Number(value))
    )
      count = Number(value);
  } catch {
    /* Optional count failures never invalidate broadcast health. */
  }
  if (viewers.size >= 128) viewers.delete(viewers.keys().next().value!);
  viewers.set(key, { at: Date.now(), count });
  return count;
}

/**
 * Read-only YouTube confirmation for a previously delivered desktop intent.
 * It cannot retrieve a CDN target or transition the broadcast lifecycle.
 */
export async function observeM4YouTubeProvider(
  accessToken: string,
  expected: {
    channelId: string;
    streamId: string;
    broadcastId: string;
    visibility?: "private" | "unlisted" | "public";
  },
  fetcher: typeof fetch = fetch,
  includeViewers = false,
  ownershipScope?: M4OwnershipVerificationScope,
): Promise<M4ProviderObservation> {
  try {
    const ids = z
      .object({
        channelId: id,
        streamId: id,
        broadcastId: id,
        visibility: z
          .enum(["private", "unlisted", "public"])
          .default("unlisted"),
      })
      .parse(expected);
    await verifyOwnedChannel(
      accessToken,
      ids.channelId,
      fetcher,
      ownershipScope,
    );

    // The owned-channel check stays first. These resource reads are independent
    // and read-only; avoid adding both network latencies to each status poll.
    const resources = await Promise.allSettled([
      get(
        `/liveStreams?part=id,snippet,status&id=${encodeURIComponent(ids.streamId)}`,
        accessToken,
        fetcher,
      ),
      get(
        `/liveBroadcasts?part=id,snippet,status,contentDetails&id=${encodeURIComponent(ids.broadcastId)}`,
        accessToken,
        fetcher,
      ),
    ]);
    if (resources[0].status === "rejected") throw resources[0].reason;
    if (resources[1].status === "rejected") throw resources[1].reason;
    const stream = streamSchema.parse(resources[0].value).items[0];
    if (
      !stream ||
      stream.id !== ids.streamId ||
      stream.snippet.channelId !== ids.channelId
    )
      throw new Error();

    const broadcast = broadcastSchema.parse(resources[1].value).items[0];
    if (
      !broadcast ||
      broadcast.id !== ids.broadcastId ||
      broadcast.snippet.channelId !== ids.channelId ||
      broadcast.status.privacyStatus !== ids.visibility ||
      broadcast.contentDetails.boundStreamId !== ids.streamId
    )
      throw new Error();

    return m4ProviderObservationSchema.parse({
      streamStatus: stream.status.streamStatus,
      healthStatus: stream.status.healthStatus?.status ?? null,
      broadcastStatus: broadcast.status.lifeCycleStatus,
      broadcastLive: broadcast.status.lifeCycleStatus === "live",
      ...(includeViewers && broadcast.status.lifeCycleStatus === "live"
        ? {
            concurrentViewers: await viewerCount(
              ids.channelId,
              ids.broadcastId,
              accessToken,
              fetcher,
            ),
          }
        : {}),
    });
  } catch (error) {
    const reason = m4YouTubeFailureCode.safeParse(
      error instanceof Error ? error.message : undefined,
    );
    throw Object.assign(
      new Error("m4_provider_observation_unavailable"),
      reason.success ? { reason: reason.data } : {},
    );
  }
}
