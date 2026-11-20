import { z } from "zod";

/** Fixed public categories only; never include provider bodies or credentials. */
export const m4YouTubeFailureCode = z.enum([
  "youtube_reconnect_required",
  "youtube_scope_missing",
  "youtube_quota_exceeded",
  "youtube_live_permission_blocked",
  "youtube_live_streaming_not_enabled",
  "youtube_provider_unavailable",
  "youtube_provider_rejected",
  "youtube_ingest_stream_missing",
  "youtube_ingest_destination_invalid",
  "m4_target_unavailable",
]);
export const m4TargetFailureStage = z.enum([
  "target_configuration",
  "target_consume",
  "target_decrypt",
  "target_oauth",
  "target_lookup",
  "target_recheck",
  "target_validate",
]);
export const m4YouTubeFailureMessages: Record<
  z.infer<typeof m4YouTubeFailureCode>,
  string
> = {
  youtube_reconnect_required:
    "Reconnect your YouTube account in YouTube settings, then retry this game's broadcast.",
  youtube_scope_missing:
    "Reconnect your YouTube account and approve permission to manage broadcasts.",
  youtube_quota_exceeded:
    "YouTube's API limit has been reached. Studio cannot start this output until API access is available again.",
  youtube_live_permission_blocked:
    "YouTube is blocking broadcasts on this channel. Check the channel in YouTube Studio.",
  youtube_live_streaming_not_enabled:
    "Enable live streaming on the connected YouTube channel first.",
  youtube_provider_unavailable:
    "YouTube could not be reached. Wait before reconnecting this broadcast.",
  youtube_provider_rejected:
    "YouTube rejected the streaming-target request. Check your YouTube account settings.",
  youtube_ingest_stream_missing:
    "YouTube could not find this broadcast's video input. Check the saved broadcast in YouTube Studio.",
  youtube_ingest_destination_invalid:
    "YouTube returned an unsupported video destination. Studio has kept your game and watch link.",
  m4_target_unavailable:
    "Studio could not obtain permission to send video. Your game and watch link are kept; check the server's target-stage diagnostic.",
};
