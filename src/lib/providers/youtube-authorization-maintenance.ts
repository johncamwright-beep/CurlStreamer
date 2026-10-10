import "server-only";

import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { revokeYouTubeRefreshToken } from "./youtube-revocation";
import { loadOwnedYouTubeChannel, refreshYouTubeAccessToken } from "./youtube";
import {
  verifyRetainedYouTubeResources,
  youtubeResourceSchema,
} from "./youtube-resource-retention";

const receiptsSchema = z
  .array(
    z.object({
      organization_id: z.uuid(),
      connection_version: z.coerce.number().int().nonnegative(),
      encrypted_credentials: z.string().min(1).max(65_536),
      channel_id: z.string().min(1).max(128).nullable(),
      disconnect_pending: z.boolean(),
      withdrawal_requested_at: z.string().nullable(),
      maintenance_claim_id: z.uuid(),
    }),
  )
  .max(100);
const resultSchema = z.enum([
  "verified",
  "removed",
  "removed_unconfirmed",
  "retry",
  "stale",
]);
type Receipt = z.infer<typeof receiptsSchema>[number];

export async function maintainYouTubeAuthorizations(
  fetcher: typeof fetch = fetch,
) {
  const client = createAdminSupabaseClient();
  const { data, error } = await client.rpc(
    "claim_youtube_authorization_maintenance",
    { p_limit: 20 },
  );
  if (error) throw new Error("youtube_maintenance_unavailable");
  const parsed = receiptsSchema.safeParse(data);
  if (!parsed.success) throw new Error("youtube_maintenance_unavailable");
  const summary = {
    processed: parsed.data.length,
    verified: 0,
    removed: 0,
    removedUnconfirmed: 0,
    retry: 0,
    stale: 0,
    failed: 0,
  };

  async function process(receipt: Receipt) {
    const deadline = Date.now() + 60_000;
    const boundedFetch: typeof fetch = (input, init) => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("youtube_maintenance_unavailable");
      const signals = [AbortSignal.timeout(remaining)];
      if (init?.signal) signals.push(init.signal);
      return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
    };
    let result: "valid" | "revoked" | "revocation_confirmed" | "unavailable" =
      "unavailable";
    let title: string | null = null;
    let refreshCompleted = false;
    try {
      const refreshToken = decryptYouTubeRefreshToken(
        receipt.encrypted_credentials,
        receipt.organization_id,
      );
      if (receipt.disconnect_pending) {
        await revokeYouTubeRefreshToken(refreshToken, boundedFetch);
        result = "revocation_confirmed";
      } else {
        const accessToken = await refreshYouTubeAccessToken(
          refreshToken,
          boundedFetch,
        );
        refreshCompleted = true;
        const channel = await loadOwnedYouTubeChannel(
          accessToken,
          boundedFetch,
        );
        if (channel.id === receipt.channel_id) {
          const inventory = await client.rpc(
            "get_youtube_maintenance_resources",
            {
              p_org: receipt.organization_id,
              p_expected_version: receipt.connection_version,
              p_claim_id: receipt.maintenance_claim_id,
            },
          );
          if (inventory.error)
            throw new Error("youtube_maintenance_unavailable");
          const resources = z
            .array(youtubeResourceSchema)
            .max(1000)
            .parse(inventory.data);
          const missing = await verifyRetainedYouTubeResources(
            accessToken,
            channel.id,
            resources,
            boundedFetch,
          );
          const recorded = await client.rpc(
            "record_youtube_resource_verification",
            {
              p_org: receipt.organization_id,
              p_expected_version: receipt.connection_version,
              p_claim_id: receipt.maintenance_claim_id,
              p_missing_broadcasts: missing.missingBroadcasts,
              p_missing_streams: missing.missingStreams,
            },
          );
          if (recorded.error || recorded.data !== true)
            throw new Error("youtube_maintenance_unavailable");
          title = channel.title;
          result = "valid";
        }
      }
    } catch (error) {
      // Only an explicit invalid-grant/authorization response proves a grant
      // unusable. Provider outages and local encryption failures retain retry.
      if (
        !receipt.disconnect_pending &&
        !refreshCompleted &&
        error instanceof Error &&
        error.message === "youtube_reconnect_required"
      )
        result = "revoked";
    }
    const finished = await client.rpc(
      "finish_youtube_authorization_maintenance",
      {
        p_org: receipt.organization_id,
        p_expected_version: receipt.connection_version,
        p_claim_id: receipt.maintenance_claim_id,
        p_result: result,
        p_channel_title: title,
      },
    );
    if (finished.error) throw new Error("youtube_maintenance_unavailable");
    const status = resultSchema.safeParse(finished.data);
    if (!status.success) throw new Error("youtube_maintenance_unavailable");
    if (status.data === "removed_unconfirmed") summary.removedUnconfirmed++;
    else summary[status.data]++;
  }
  // Bound Google request concurrency and isolate one team/provider failure.
  for (let offset = 0; offset < parsed.data.length; offset += 5) {
    const settled = await Promise.allSettled(
      parsed.data.slice(offset, offset + 5).map(process),
    );
    summary.failed += settled.filter(
      (item) => item.status === "rejected",
    ).length;
  }
  return summary;
}
