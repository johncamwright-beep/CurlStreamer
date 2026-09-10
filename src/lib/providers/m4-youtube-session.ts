import "server-only";
import { randomUUID } from "node:crypto";
import { youtubeLifecycle } from "./youtube-lifecycle";
import { z } from "zod";
import {
  completionActorParameters,
  type CompletionCredential,
} from "@/lib/game-completion";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";
import { decryptYouTubeRefreshToken } from "./youtube-credential-vault";
import {
  refreshYouTubeAccessToken,
  youtubeConfigurationStatus,
  loadOwnedYouTubeChannel,
} from "./youtube";
import { verifyM4ProviderRetirement } from "./m4-provider-retirement";
import { observeM4YouTubeProvider } from "./m4-provider-observation";
import {
  bindYouTubeBroadcast,
  deleteYouTubeStream,
  findOrCreateYouTubeBroadcast,
  findOrCreateYouTubeStream,
  findYouTubeBroadcast,
  findYouTubeStream,
  finishYouTubeBroadcast,
  transitionYouTubeBroadcast,
} from "./youtube-live";

export const m4ErrorCodeSchema = z.enum([
  "youtube_reconnect_required",
  "broadcast_operation_uncertain",
  "broadcast_discovery_incomplete",
  "youtube_manual_configuration_mismatch",
  "youtube_broadcast_terminal",
  "m4_provider_unavailable",
  "m4_operation_fenced",
  "m4_retirement_unconfirmed",
]);
const creationSchema = z.enum(["none", "intent", "ready", "uncertain"]);
const statusSchema = z.enum([
  "idle",
  "preparing",
  "prepared",
  "stopping",
  "stopped",
  "failed",
]);
const sessionSchema = z.object({
  gameId: z.uuid(),
  transport: z.literal("local-obs").optional(),
  organizationId: z.uuid().optional(),
  sessionKey: z.uuid().optional(),
  action: z.enum(["run", "wait", "none"]).optional(),
  generation: z.coerce.number().int().nonnegative().optional(),
  operationToken: z.uuid().optional(),
  desiredState: z.enum(["live", "stopped"]),
  status: statusSchema,
  title: z.string().min(2).max(100).optional(),
  visibility: z.literal("unlisted").optional(),
  encryptedCredentials: z.string().optional(),
  savedChannelId: z.string().min(1).optional(),
  channelId: z.string().min(1).optional(),
  connectionVersion: z.coerce.number().int().positive().optional(),
  youtubeBroadcastId: z.string().optional(),
  youtubeStreamId: z.string().optional(),
  watchUrl: youtubeWatchUrlSchema.optional(),
  youtubeBroadcastCreateState: creationSchema.optional(),
  youtubeStreamCreateState: creationSchema.optional(),
  lastErrorCode: z.string().optional(),
});
type Session = z.infer<typeof sessionSchema>;
export type SafeM4Session = {
  desiredState: Session["desiredState"];
  status: Session["status"];
  watchUrl?: string;
  lastErrorCode?: z.infer<typeof m4ErrorCodeSchema>;
};
function safe(s: Session): SafeM4Session {
  const code = m4ErrorCodeSchema.safeParse(s.lastErrorCode);
  return {
    desiredState: s.desiredState,
    status: s.status,
    ...(s.watchUrl ? { watchUrl: s.watchUrl } : {}),
    ...(s.lastErrorCode
      ? {
          lastErrorCode: code.success
            ? code.data
            : ("m4_provider_unavailable" as const),
        }
      : {}),
  };
}
export function m4Configuration() {
  return (
    process.env.CURLCAST_M4_LOCAL_YOUTUBE === "disposable" &&
    youtubeConfigurationStatus()
  );
}
async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    name,
    parameters,
  );
  if (error)
    throw Object.assign(new Error("m4_database_unavailable"), {
      code: error.code,
    });
  return data;
}
async function actor(gameId: string, credential: CompletionCredential) {
  return {
    p_game_id: gameId,
    ...(await completionActorParameters(gameId, credential)),
  };
}
export async function readM4Session(
  gameId: string,
  credential: CompletionCredential,
) {
  return safe(
    sessionSchema.parse(
      await rpc("get_m4_broadcast_session", await actor(gameId, credential)),
    ),
  );
}

/** Explicit organizer start, after verifying YouTube reception and current authority. */
export async function goLiveM4Session(
  gameId: string,
  credential: CompletionCredential,
) {
  if (!m4Configuration()) throw Error("m4_provider_unavailable");
  const read = async () =>
    sessionSchema.parse(
      await rpc("get_m4_broadcast_session", await actor(gameId, credential)),
    );
  const initial = await read();
  if (
    initial.status !== "prepared" ||
    initial.desiredState !== "live" ||
    !initial.youtubeBroadcastId ||
    !initial.youtubeStreamId ||
    !initial.channelId
  )
    throw Object.assign(Error("m4_not_ready"), { code: "55000" });
  const token = await accessToken(initial);
  const observation = await observeM4YouTubeProvider(token, {
    channelId: initial.channelId,
    streamId: initial.youtubeStreamId,
    broadcastId: initial.youtubeBroadcastId,
  });
  const current = await read();
  for (const key of [
    "generation",
    "status",
    "desiredState",
    "youtubeBroadcastId",
    "youtubeStreamId",
    "channelId",
    "connectionVersion",
    "encryptedCredentials",
  ] as const)
    if (current[key] !== initial[key])
      throw Object.assign(Error("m4_operation_fenced"), { code: "55000" });
  if (!m4Configuration()) throw Error("m4_provider_unavailable");
  const phase = youtubeLifecycle(
    observation.broadcastStatus,
    observation.streamStatus,
  );
  if (phase !== "go-live") return { ...safe(current), phase };
  await transitionYouTubeBroadcast(token, initial.youtubeBroadcastId, "live");
  // A successful transition request is not proof that the broadcast is live.
  return { ...safe(current), phase: "starting" };
}
async function claim(
  gameId: string,
  credential: CompletionCredential,
  desired: "prepared" | "stopped",
) {
  return sessionSchema.parse(
    await rpc("claim_m4_broadcast_operation", {
      ...(await actor(gameId, credential)),
      p_desired_state: desired,
      p_operation_token: randomUUID(),
    }),
  );
}
type RecordValues = {
  youtubeBroadcastId?: string;
  youtubeStreamId?: string;
  watchUrl?: string;
  errorCode?: z.infer<typeof m4ErrorCodeSchema>;
  providerStep?: string;
  uncertain?: boolean;
  youtubeBroadcastCreateState?: z.infer<typeof creationSchema>;
  youtubeStreamCreateState?: z.infer<typeof creationSchema>;
};
async function record(
  s: Session,
  status: Session["status"],
  v: RecordValues = {},
) {
  if (!s.generation || !s.operationToken) throw Error("m4_operation_fenced");
  const data = await rpc("record_m4_broadcast_operation", {
    p_game_id: s.gameId,
    p_generation: s.generation,
    p_operation_token: s.operationToken,
    p_status: status,
    p_youtube_broadcast_id: v.youtubeBroadcastId ?? null,
    p_youtube_stream_id: v.youtubeStreamId ?? null,
    p_watch_url: v.watchUrl ?? null,
    p_error_code: v.errorCode ?? null,
    p_provider_step: v.providerStep ?? null,
    p_uncertain: v.uncertain ?? false,
    p_youtube_broadcast_create_state: v.youtubeBroadcastCreateState ?? null,
    p_youtube_stream_create_state: v.youtubeStreamCreateState ?? null,
  });
  if (!data) throw Error("m4_operation_fenced");
  return sessionSchema.parse(data);
}
async function accessToken(s: Session) {
  if (!s.organizationId || !s.encryptedCredentials)
    throw Error("youtube_reconnect_required");
  return refreshYouTubeAccessToken(
    decryptYouTubeRefreshToken(s.encryptedCredentials, s.organizationId),
  );
}
function code(error: unknown): z.infer<typeof m4ErrorCodeSchema> {
  const result = m4ErrorCodeSchema.safeParse(
    error instanceof Error ? error.message : "",
  );
  return result.success ? result.data : "m4_provider_unavailable";
}
async function failed(
  s: Session,
  error: unknown,
  gameId: string,
  credential: CompletionCredential,
  values: RecordValues = {},
) {
  const errorCode = code(error);
  if (errorCode !== "m4_operation_fenced") {
    try {
      return safe(
        await record(s, "failed", { ...values, errorCode, uncertain: true }),
      );
    } catch {
      /* A newer owner or terminal transition controls the durable state. */
    }
  }
  // Never claim prepared/stopped from stale local state after losing a fence.
  return readM4Session(gameId, credential);
}

/** Prepare provider resources only. Never starts an encoder or transitions live. */
export async function prepareM4Session(
  gameId: string,
  credential: CompletionCredential,
): Promise<SafeM4Session> {
  if (!m4Configuration())
    throw Object.assign(Error("M4 preparation unavailable"), { code: "55000" });
  let s: Session;
  try {
    s = await claim(gameId, credential, "prepared");
  } catch (error) {
    if ((error as { code?: string })?.code !== "55000") throw error;
    const cleanup = sessionSchema.parse(
      await rpc("claim_abandoned_m4_cleanup", {
        ...(await actor(gameId, credential)),
        p_operation_token: randomUUID(),
      }),
    );
    const retired = await finishM4Session(gameId, credential, cleanup);
    if (retired.status !== "stopped") return retired;
    s = await claim(gameId, credential, "prepared");
  }
  if (s.action !== "run") return safe(s);
  let creating: "broadcast" | "stream" | undefined;
  try {
    if (!s.sessionKey || !s.title || s.visibility !== "unlisted")
      throw Error("youtube_manual_configuration_mismatch");
    const sessionKey = s.sessionKey,
      title = s.title;
    const token = await accessToken(s);
    const allowBroadcast = (s.youtubeBroadcastCreateState ?? "none") === "none";
    creating = "broadcast";
    s = await record(s, "preparing", {
      providerStep: "m4-broadcast-intent",
      uncertain: true,
      ...(allowBroadcast ? { youtubeBroadcastCreateState: "intent" } : {}),
    });
    const broadcast = await findOrCreateYouTubeBroadcast(
      {
        accessToken: token,
        sessionKey,
        title,
        visibility: "unlisted",
        manualLifecycle: true,
      },
      fetch,
      allowBroadcast,
    );
    s = await record(s, "preparing", {
      youtubeBroadcastId: broadcast.id,
      watchUrl: broadcast.watchUrl,
      youtubeBroadcastCreateState: "ready",
      providerStep: "m4-broadcast-ready",
    });
    creating = undefined;
    if (!["created", "ready"].includes(broadcast.lifeCycleStatus ?? ""))
      throw Error("youtube_broadcast_terminal");
    const allowStream = (s.youtubeStreamCreateState ?? "none") === "none";
    creating = "stream";
    s = await record(s, "preparing", {
      providerStep: "m4-stream-intent",
      uncertain: true,
      ...(allowStream ? { youtubeStreamCreateState: "intent" } : {}),
    });
    const stream = await findOrCreateYouTubeStream(
      { accessToken: token, sessionKey, title },
      fetch,
      allowStream,
    );
    s = await record(s, "preparing", {
      youtubeStreamId: stream.id,
      youtubeStreamCreateState: "ready",
      providerStep: "m4-stream-ready",
    });
    creating = undefined;
    // The returned ingestion target remains server-local and is not persisted or returned.
    await bindYouTubeBroadcast(token, broadcast.id, stream.id);
    s = await record(s, "prepared", { providerStep: "m4-prepared" });
    return safe(s);
  } catch (error) {
    return failed(s, error, gameId, credential, {
      providerStep: "m4-prepare-uncertain",
      ...(creating === "broadcast"
        ? { youtubeBroadcastCreateState: "uncertain" }
        : {}),
      ...(creating === "stream"
        ? { youtubeStreamCreateState: "uncertain" }
        : {}),
    });
  }
}

/** Provider-confirmed retirement. Local stop or a failed request cannot clear delivery history. */
export async function stopM4Session(
  gameId: string,
  credential: CompletionCredential,
): Promise<SafeM4Session> {
  return finishM4Session(
    gameId,
    credential,
    await claim(gameId, credential, "stopped"),
  );
}
async function finishM4Session(
  gameId: string,
  credential: CompletionCredential,
  s: Session,
): Promise<SafeM4Session> {
  if (s.action !== "run") return safe(s);
  try {
    if (!s.sessionKey) throw Error("m4_operation_fenced");
    const hasResources =
      Boolean(s.youtubeBroadcastId || s.youtubeStreamId) ||
      [s.youtubeBroadcastCreateState, s.youtubeStreamCreateState].some(
        (value) => value && value !== "none",
      );
    if (hasResources) {
      const context = {
        channelId: s.savedChannelId,
        version: s.connectionVersion,
        encrypted: s.encryptedCredentials,
      };
      if (
        !context.channelId ||
        context.channelId !== s.channelId ||
        !context.version ||
        !context.encrypted
      )
        throw Error("youtube_reconnect_required");
      const token = await accessToken(s);
      if ((await loadOwnedYouTubeChannel(token)).id !== context.channelId)
        throw Error("youtube_reconnect_required");
      let broadcastId = s.youtubeBroadcastId,
        streamId = s.youtubeStreamId;
      if (!broadcastId && s.youtubeBroadcastCreateState !== "none")
        broadcastId = (await findYouTubeBroadcast(token, s.sessionKey))?.id;
      if (!streamId && s.youtubeStreamCreateState !== "none")
        streamId = (await findYouTubeStream(token, s.sessionKey))?.id;
      if (
        (!broadcastId &&
          ["intent", "uncertain", "ready"].includes(
            s.youtubeBroadcastCreateState ?? "none",
          )) ||
        (!streamId &&
          ["intent", "uncertain", "ready"].includes(
            s.youtubeStreamCreateState ?? "none",
          ))
      )
        throw Error("broadcast_operation_uncertain");
      s = await record(s, "stopping", {
        youtubeBroadcastId: broadcastId,
        youtubeStreamId: streamId,
        providerStep: "m4-cleanup-intent",
      });
      let finishUncertain = false;
      try {
        if (broadcastId) await finishYouTubeBroadcast(token, broadcastId);
      } catch {
        finishUncertain = true;
      }
      const resources = { broadcastId, streamId, channelId: context.channelId };
      if (finishUncertain) {
        // A lost response can be resolved only by independent positive reads.
        await verifyM4ProviderRetirement(token, {
          broadcastId,
          channelId: context.channelId,
        });
      }
      s = await record(s, "stopping", {
        providerStep: "m4-broadcast-finished",
      });
      try {
        await deleteYouTubeStream(token, streamId);
      } catch {
        /* Never treat HTTP status alone as evidence; inspect below. */
      }
      await verifyM4ProviderRetirement(token, resources);
      const retired = sessionSchema.parse(
        await rpc("confirm_m4_provider_retirement", {
          ...(await actor(gameId, credential)),
          p_generation: s.generation,
          p_operation_token: s.operationToken,
          p_youtube_broadcast_id: broadcastId ?? null,
          p_youtube_stream_id: streamId ?? null,
          p_youtube_channel_id: context.channelId,
          p_connection_version: context.version,
          p_encrypted_credentials: context.encrypted,
        }),
      );
      if (
        retired.gameId !== gameId ||
        retired.status !== "stopped" ||
        retired.desiredState !== "stopped"
      )
        throw Error("m4_operation_fenced");
      return safe(retired);
    }
    return safe(await record(s, "stopped", { providerStep: "m4-stopped" }));
  } catch (error) {
    return failed(s, error, gameId, credential, {
      providerStep: "m4-cleanup-uncertain",
    });
  }
}
