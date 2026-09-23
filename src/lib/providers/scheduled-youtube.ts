import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { getScheduledYouTubeCredentials } from "./scheduled-youtube-credentials";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import { refreshYouTubeAccessToken } from "./youtube";
import {
  findOrCreateYouTubeBroadcast,
  updateScheduledYouTubeTime,
} from "./youtube-live";
import {
  uploadScheduledThumbnail,
  type ScheduledThumbnail,
} from "./youtube-thumbnail";

function providerError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.startsWith("youtube_")
    ? message
    : "youtube_provider_unavailable";
}

/** Reserve a game watch page after its database transaction commits. */
export async function provisionScheduledYouTubeBroadcast(
  user: User,
  values: {
    gameId: string;
    title: string;
    scheduledStart: string;
    thumbnail?: ScheduledThumbnail;
  },
) {
  const db = createAdminSupabaseClient();
  // Do this before claiming provider creation intent. A disconnected channel
  // is retryable and must not fence future creation as an uncertain insert.
  let credentials;
  let accessToken: string;
  try {
    credentials = await getScheduledYouTubeCredentials(user, values.gameId);
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
  async function thumbnail(videoId: string) {
    if (!values.thumbnail) return {};
    try {
      await uploadScheduledThumbnail(accessToken, videoId, values.thumbnail);
      return { thumbnailStatus: "ready" as const };
    } catch {
      // The watch page is already saved. A thumbnail failure must never create
      // another broadcast or prevent the game from being scheduled.
      return { thumbnailStatus: "pending" as const };
    }
  }
  if (action === "none") {
    const watchUrl = claimed[0]?.watch_url;
    const videoId = watchUrl ? new URL(watchUrl).searchParams.get("v") : null;
    if (videoId && values.thumbnail) {
      try {
        await updateScheduledYouTubeTime(
          accessToken,
          videoId,
          values.gameId,
          values.title,
          values.scheduledStart,
        );
      } catch {
        return {
          status: "pending",
          watchUrl: watchUrl ?? null,
          errorCode: "youtube_schedule_update_pending",
        } as const;
      }
    }
    return {
      status: "ready",
      watchUrl: claimed[0]?.watch_url ?? null,
      ...(videoId ? await thumbnail(videoId) : {}),
    } as const;
  }
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
      ...(row?.status === "ready" ? await thumbnail(broadcast.id) : {}),
    } as const;
  } catch (error) {
    const code = providerError(error);
    // Once the claim exists, even a local persistence error can follow a
    // successful provider insert. Preserve intent so the next request only
    // discovers the game-id marker and cannot create a duplicate event.
    return { status: "pending", watchUrl: null, errorCode: code } as const;
  }
}
