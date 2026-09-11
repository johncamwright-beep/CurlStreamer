import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getYouTubeCredentials } from "@/lib/youtube-connection";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { refreshYouTubeAccessToken } from "./youtube";
import { findOrCreateYouTubeBroadcast } from "./youtube-live";

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("youtube_")
    ? message
    : "youtube_provider_unavailable";
}

/** Reserve a game watch page after its database transaction commits. */
export async function provisionScheduledYouTubeBroadcast(
  user: User,
  values: { gameId: string; title: string; scheduledStart: string },
) {
  const db = createAdminSupabaseClient();
  // Do this before claiming provider creation intent. A disconnected channel
  // is retryable and must not fence future creation as an uncertain insert.
  let credentials;
  let accessToken: string;
  try {
    credentials = await getYouTubeCredentials(user);
    accessToken = await refreshYouTubeAccessToken(
      decryptYouTubeRefreshToken(
        credentials.encrypted_credentials,
        credentials.organization_id,
      ),
    );
  } catch (error) {
    return {
      status: "pending",
      watchUrl: null,
      errorCode: providerError(error),
    } as const;
  }
  const { data: claim, error: claimError } = await db.rpc(
    "claim_scheduled_youtube_broadcast",
    { p_user_id: user.id, p_game_id: values.gameId },
  );
  if (claimError)
    return {
      status: "failed",
      watchUrl: null,
      errorCode: "youtube_schedule_unavailable",
    } as const;
  const claimed = claim as {
    action?: "run" | "discover" | "none";
    watch_url?: string | null;
  }[];
  const action = claimed[0]?.action;
  if (action === "none")
    return {
      status: "ready",
      watchUrl: claimed[0]?.watch_url ?? null,
    } as const;
  if (action !== "run" && action !== "discover")
    return {
      status: "failed",
      watchUrl: null,
      errorCode: "youtube_schedule_unavailable",
    } as const;
  try {
    const signal = AbortSignal.timeout(8_000);
    const scheduledFetch: typeof fetch = (input, init) =>
      fetch(input, { ...init, signal });
    const broadcast = await findOrCreateYouTubeBroadcast(
      {
        accessToken,
        sessionKey: values.gameId,
        title: values.title,
        visibility: "unlisted",
        manualLifecycle: true,
        scheduledStartTime: values.scheduledStart,
      },
      scheduledFetch,
      action === "run",
    );
    const { data, error } = await db.rpc("record_scheduled_youtube_broadcast", {
      p_user_id: user.id,
      p_game_id: values.gameId,
      p_broadcast_id: broadcast.id,
      p_watch_url: broadcast.watchUrl,
      p_error_code: null,
      p_channel_id: credentials.channel_id,
      p_connection_version: credentials.connection_version,
    });
    if (error) throw new Error("youtube_schedule_persistence_failed");
    const row = (data as { status?: string; watch_url?: string | null }[])[0];
    return {
      status: row?.status === "ready" ? "ready" : "failed",
      watchUrl: row?.watch_url ?? null,
    } as const;
  } catch (error) {
    const code = providerError(error);
    // Once the claim exists, even a local persistence error can follow a
    // successful provider insert. Preserve intent so the next request only
    // discovers the game-id marker and cannot create a duplicate event.
    return { status: "pending", watchUrl: null, errorCode: code } as const;
  }
}
