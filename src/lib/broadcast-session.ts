import "server-only";

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EgressStatus } from "livekit-server-sdk";
import {
  completionActorParameters,
  type CompletionCredential,
} from "@/lib/game-completion";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { decryptYouTubeRefreshToken } from "@/lib/providers/youtube-credential-vault";
import { refreshYouTubeAccessToken } from "@/lib/providers/youtube";
import { youtubeConfigurationStatus } from "@/lib/providers/youtube";
import {
  bindYouTubeBroadcast,
  deleteYouTubeStream,
  findOrCreateYouTubeBroadcast,
  findOrCreateYouTubeStream,
  finishYouTubeBroadcast,
  findYouTubeBroadcast,
  findYouTubeStream,
  getYouTubeBroadcastStatus,
  getYouTubeStreamStatus,
  transitionYouTubeBroadcast,
} from "@/lib/providers/youtube-live";
import {
  findOrStartLiveKitEgress,
  findLiveKitEgress,
  getLiveKitEgressStatus,
  stopLiveKitEgress,
} from "@/lib/providers/livekit-egress";

const statusSchema = z.enum([
  "idle",
  "preparing",
  "live",
  "stopping",
  "stopped",
  "failed",
]);
const sessionSchema = z.object({
  action: z.enum(["run", "wait", "none"]).optional(),
  gameId: z.uuid(),
  organizationId: z.uuid().optional(),
  sessionKey: z.uuid().optional(),
  generation: z.coerce.number().int().nonnegative().optional(),
  operationToken: z.uuid().optional(),
  desiredState: z.enum(["live", "stopped"]),
  status: statusSchema,
  youtubeBroadcastId: z.string().optional(),
  youtubeStreamId: z.string().optional(),
  livekitEgressId: z.string().optional(),
  watchUrl: z.url().optional(),
  lastErrorCode: z.string().optional(),
  providerStep: z.string().optional(),
  uncertainSince: z.string().datetime({ offset: true }).optional(),
  youtubeBroadcastCreateState: z
    .enum(["none", "intent", "ready", "uncertain"])
    .optional(),
  youtubeStreamCreateState: z
    .enum(["none", "intent", "ready", "uncertain"])
    .optional(),
  livekitEgressCreateState: z
    .enum(["none", "intent", "ready", "uncertain"])
    .optional(),
  title: z.string().min(2).max(100).optional(),
  visibility: z.enum(["private", "unlisted", "public"]).optional(),
  encryptedCredentials: z.string().optional(),
  channelId: z.string().optional(),
});

type Session = z.infer<typeof sessionSchema>;
export type SafeBroadcastSession = Pick<
  Session,
  "desiredState" | "status" | "watchUrl" | "lastErrorCode"
>;

export function parseBroadcastSession(value: unknown) {
  return sessionSchema.parse(value);
}

export function broadcastStartConfiguration(requestUrl: string) {
  const renderOrigin = process.env.APP_BASE_URL;
  try {
    const requestOrigin = new URL(requestUrl).origin;
    const configuredOrigin = renderOrigin ? new URL(renderOrigin).origin : "";
    return Boolean(
      youtubeConfigurationStatus() &&
      process.env.LIVEKIT_API_KEY &&
      process.env.LIVEKIT_API_SECRET &&
      (process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL) &&
      renderOrigin === configuredOrigin &&
      requestOrigin === configuredOrigin,
    );
  } catch {
    return false;
  }
}

function safe(value: Session): SafeBroadcastSession {
  return {
    desiredState: value.desiredState,
    status: value.status,
    ...(value.watchUrl ? { watchUrl: value.watchUrl } : {}),
    ...(value.lastErrorCode ? { lastErrorCode: value.lastErrorCode } : {}),
  };
}

async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    name,
    parameters,
  );
  if (error)
    throw Object.assign(new Error("broadcast_database_unavailable"), error);
  return parseBroadcastSession(data);
}

async function actor(gameId: string, credential: CompletionCredential) {
  return completionActorParameters(gameId, credential);
}

async function claim(
  gameId: string,
  credential: CompletionCredential,
  desiredState: "live" | "stopped",
) {
  return rpc("claim_game_broadcast_operation", {
    p_game_id: gameId,
    ...(await actor(gameId, credential)),
    p_desired_state: desiredState,
    p_operation_token: randomUUID(),
  });
}

async function record(
  session: Session,
  status: Session["status"],
  values: {
    youtubeBroadcastId?: string;
    youtubeStreamId?: string;
    livekitEgressId?: string;
    watchUrl?: string;
    errorCode?: string;
    providerStep?: string;
    uncertain?: boolean;
    youtubeBroadcastCreateState?: "none" | "intent" | "ready" | "uncertain";
    youtubeStreamCreateState?: "none" | "intent" | "ready" | "uncertain";
    livekitEgressCreateState?: "none" | "intent" | "ready" | "uncertain";
  } = {},
) {
  if (!session.generation || !session.operationToken)
    throw new Error("broadcast_claim_invalid");
  const { data, error } = await createAdminSupabaseClient().rpc(
    "record_game_broadcast_operation",
    {
      p_game_id: session.gameId,
      p_generation: session.generation,
      p_operation_token: session.operationToken,
      p_status: status,
      p_youtube_broadcast_id: values.youtubeBroadcastId ?? null,
      p_youtube_stream_id: values.youtubeStreamId ?? null,
      p_livekit_egress_id: values.livekitEgressId ?? null,
      p_watch_url: values.watchUrl ?? null,
      p_error_code: values.errorCode ?? null,
      p_provider_step: values.providerStep ?? null,
      p_uncertain: values.uncertain ?? false,
      p_youtube_broadcast_create_state:
        values.youtubeBroadcastCreateState ?? null,
      p_youtube_stream_create_state: values.youtubeStreamCreateState ?? null,
      p_livekit_egress_create_state: values.livekitEgressCreateState ?? null,
    },
  );
  if (error)
    throw Object.assign(new Error("broadcast_database_unavailable"), error);
  return data ? parseBroadcastSession(data) : undefined;
}

async function accessToken(session: Session) {
  if (!session.organizationId || !session.encryptedCredentials)
    throw new Error("youtube_reconnect_required");
  const refreshToken = decryptYouTubeRefreshToken(
    session.encryptedCredentials,
    session.organizationId,
  );
  return refreshYouTubeAccessToken(refreshToken);
}

function errorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "youtube_reconnect_required") return message;
  if (message === "broadcast_operation_uncertain") return message;
  if (message === "broadcast_discovery_incomplete") return message;
  if (message.startsWith("livekit_")) return "livekit_provider_unavailable";
  if (message.startsWith("youtube_")) return message;
  if (message.startsWith("broadcast_render_")) return message;
  return "broadcast_provider_unavailable";
}

async function compensateStart(
  gameId: string,
  credential: CompletionCredential,
) {
  return stopGameBroadcast(gameId, credential);
}

export async function readBroadcastSession(
  gameId: string,
  credential: CompletionCredential,
) {
  const session = await rpc("get_game_broadcast_session", {
    p_game_id: gameId,
    ...(await actor(gameId, credential)),
  });
  if (session.status !== "live") return safe(session);
  if (!session.youtubeBroadcastId || !session.livekitEgressId)
    return safe({
      ...session,
      status: "failed",
      lastErrorCode: "broadcast_status_incomplete",
    });
  try {
    const token = await accessToken(session);
    const [youtubeStatus, egressStatus] = await Promise.all([
      getYouTubeBroadcastStatus(token, session.youtubeBroadcastId),
      getLiveKitEgressStatus(session.livekitEgressId),
    ]);
    if (
      youtubeStatus === "live" &&
      [EgressStatus.EGRESS_STARTING, EgressStatus.EGRESS_ACTIVE].includes(
        egressStatus!,
      )
    )
      return safe(session);
    const failed = await record(session, "failed", {
      errorCode: "broadcast_provider_ended",
      providerStep: "status-reconciliation",
    });
    return safe(
      failed ?? {
        ...session,
        status: "failed",
        lastErrorCode: "broadcast_provider_ended",
      },
    );
  } catch {
    return safe({
      ...session,
      status: "failed",
      lastErrorCode: "broadcast_status_unavailable",
    });
  }
}

export async function startGameBroadcast(
  gameId: string,
  credential: CompletionCredential,
): Promise<SafeBroadcastSession> {
  let session = await claim(gameId, credential, "live");
  if (session.action !== "run") return safe(session);
  let token: string | undefined;
  let broadcastId = session.youtubeBroadcastId;
  let egressId = session.livekitEgressId;
  let step = "refresh-token";
  let creation:
    "youtube-broadcast" | "youtube-stream" | "livekit-egress" | undefined;
  try {
    if (!session.sessionKey || !session.title || !session.visibility)
      throw new Error("broadcast_claim_invalid");
    const sessionKey = session.sessionKey;
    const title = session.title;
    const visibility = session.visibility;
    token = await accessToken(session);
    step = "youtube-broadcast-create";
    creation = "youtube-broadcast";
    const mayCreateBroadcast =
      (session.youtubeBroadcastCreateState ?? "none") === "none";
    if (mayCreateBroadcast) {
      const broadcastIntent = await record(session, "preparing", {
        providerStep: step,
        uncertain: true,
        youtubeBroadcastCreateState: "intent",
      });
      if (!broadcastIntent) return compensateStart(gameId, credential);
      session = { ...session, ...broadcastIntent };
    }
    const broadcast = await findOrCreateYouTubeBroadcast(
      {
        accessToken: token,
        sessionKey,
        title,
        visibility,
      },
      fetch,
      mayCreateBroadcast,
    );
    broadcastId = broadcast.id;
    const savedBroadcast = await record(session, "preparing", {
      youtubeBroadcastId: broadcast.id,
      watchUrl: broadcast.watchUrl,
      providerStep: "youtube-broadcast-ready",
      youtubeBroadcastCreateState: "ready",
    });
    if (!savedBroadcast) return compensateStart(gameId, credential);
    session = { ...session, ...savedBroadcast };
    creation = undefined;
    if (broadcast.lifeCycleStatus === "complete")
      throw new Error("youtube_broadcast_terminal");

    step = "youtube-stream-create";
    creation = "youtube-stream";
    const mayCreateStream =
      (session.youtubeStreamCreateState ?? "none") === "none";
    if (mayCreateStream) {
      const streamIntent = await record(session, "preparing", {
        providerStep: step,
        uncertain: true,
        youtubeStreamCreateState: "intent",
      });
      if (!streamIntent) return compensateStart(gameId, credential);
      session = { ...session, ...streamIntent };
    }
    const stream = await findOrCreateYouTubeStream(
      {
        accessToken: token,
        sessionKey,
        title,
      },
      fetch,
      mayCreateStream,
    );
    const savedStream = await record(session, "preparing", {
      youtubeStreamId: stream.id,
      providerStep: "youtube-stream-ready",
      youtubeStreamCreateState: "ready",
    });
    if (!savedStream) return compensateStart(gameId, credential);
    session = { ...session, ...savedStream };
    creation = undefined;
    if (!["live", "complete"].includes(broadcast.lifeCycleStatus ?? ""))
      await bindYouTubeBroadcast(token, broadcast.id, stream.id);

    step = "livekit-egress-create";
    creation = "livekit-egress";
    const mayCreateEgress =
      (session.livekitEgressCreateState ?? "none") === "none";
    if (mayCreateEgress) {
      const egressIntent = await record(session, "preparing", {
        providerStep: step,
        uncertain: true,
        livekitEgressCreateState: "intent",
      });
      if (!egressIntent) return compensateStart(gameId, credential);
      session = { ...session, ...egressIntent };
    }
    const egress = await findOrStartLiveKitEgress(
      {
        gameId,
        sessionKey,
        rtmpUrl: stream.rtmpUrl,
      },
      undefined,
      mayCreateEgress,
    );
    egressId = egress.id;
    const savedEgress = await record(session, "preparing", {
      livekitEgressId: egress.id,
      providerStep: "livekit-egress-ready",
      livekitEgressCreateState: "ready",
    });
    if (!savedEgress) return compensateStart(gameId, credential);
    session = { ...session, ...savedEgress };
    creation = undefined;

    let streamStatus = stream.streamStatus;
    for (
      let attempt = 0;
      attempt < 5 && streamStatus !== "active";
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      streamStatus = await getYouTubeStreamStatus(token, stream.id);
    }
    if (streamStatus !== "active") return safe(session);
    let broadcastStatus = await getYouTubeBroadcastStatus(token, broadcast.id);
    if (broadcastStatus !== "live") {
      try {
        await transitionYouTubeBroadcast(token, broadcast.id, "live");
      } catch (error) {
        broadcastStatus = await getYouTubeBroadcastStatus(token, broadcast.id);
        if (broadcastStatus !== "live") throw error;
      }
    }
    const live = await record(session, "live", {
      youtubeBroadcastId: broadcast.id,
      youtubeStreamId: stream.id,
      livekitEgressId: egress.id,
      watchUrl: broadcast.watchUrl,
      providerStep: "live",
    });
    if (!live) return compensateStart(gameId, credential);
    return safe(live);
  } catch (error) {
    const code = errorCode(error);
    const uncertain =
      code.includes("unavailable") ||
      code === "broadcast_operation_uncertain" ||
      code === "broadcast_discovery_incomplete";
    const failed = await record(session, "failed", {
      youtubeBroadcastId: broadcastId,
      livekitEgressId: egressId,
      errorCode: code,
      providerStep: `${step}-uncertain`,
      uncertain,
      ...(creation === "youtube-broadcast"
        ? {
            youtubeBroadcastCreateState: uncertain ? "uncertain" : "none",
          }
        : {}),
      ...(creation === "youtube-stream"
        ? {
            youtubeStreamCreateState: uncertain ? "uncertain" : "none",
          }
        : {}),
      ...(creation === "livekit-egress"
        ? { livekitEgressCreateState: uncertain ? "uncertain" : "none" }
        : {}),
    }).catch(() => undefined);
    return failed
      ? safe(failed)
      : safe({ ...session, status: "failed", lastErrorCode: code });
  }
}

export async function stopGameBroadcast(
  gameId: string,
  credential: CompletionCredential,
): Promise<SafeBroadcastSession> {
  let session = await claim(gameId, credential, "stopped");
  if (session.action !== "run") return safe(session);
  try {
    if (!session.sessionKey) throw new Error("broadcast_claim_invalid");
    const sessionKey = session.sessionKey;
    const cleanupErrors: string[] = [];
    let egressId = session.livekitEgressId;
    let broadcastId = session.youtubeBroadcastId;
    let streamId = session.youtubeStreamId;
    const needsEgress =
      Boolean(egressId) ||
      (session.livekitEgressCreateState ?? "none") !== "none";
    const needsYouTube =
      Boolean(broadcastId || streamId) ||
      (session.youtubeBroadcastCreateState ?? "none") !== "none" ||
      (session.youtubeStreamCreateState ?? "none") !== "none";

    if (needsEgress) {
      try {
        if (!egressId)
          egressId = (await findLiveKitEgress(gameId, sessionKey))?.egressId;
        if (
          ["intent", "uncertain"].includes(
            session.livekitEgressCreateState ?? "none",
          ) &&
          !egressId
        )
          throw new Error("broadcast_operation_uncertain");
        if (egressId && !session.livekitEgressId) {
          const saved = await record(session, "stopping", {
            livekitEgressId: egressId,
            livekitEgressCreateState: "ready",
            providerStep: "livekit-egress-discovered",
          });
          if (!saved) return { desiredState: "stopped", status: "stopping" };
          session = { ...session, ...saved };
        }
        await stopLiveKitEgress(egressId);
      } catch (error) {
        cleanupErrors.push(errorCode(error));
      }
    }

    if (needsYouTube) {
      try {
        const token = await accessToken(session);
        if (!broadcastId)
          broadcastId = (await findYouTubeBroadcast(token, sessionKey))?.id;
        if (!streamId)
          streamId = (await findYouTubeStream(token, sessionKey))?.id;
        if (
          (["intent", "uncertain"].includes(
            session.youtubeBroadcastCreateState ?? "none",
          ) &&
            !broadcastId) ||
          (["intent", "uncertain"].includes(
            session.youtubeStreamCreateState ?? "none",
          ) &&
            !streamId)
        )
          throw new Error("broadcast_operation_uncertain");
        if (
          (broadcastId && !session.youtubeBroadcastId) ||
          (streamId && !session.youtubeStreamId)
        ) {
          const saved = await record(session, "stopping", {
            youtubeBroadcastId: broadcastId,
            youtubeStreamId: streamId,
            youtubeBroadcastCreateState: broadcastId ? "ready" : undefined,
            youtubeStreamCreateState: streamId ? "ready" : undefined,
            providerStep: "youtube-resources-discovered",
          });
          if (!saved) return { desiredState: "stopped", status: "stopping" };
          session = { ...session, ...saved };
        }
        if (broadcastId) await finishYouTubeBroadcast(token, broadcastId);
        await deleteYouTubeStream(token, streamId);
      } catch (error) {
        cleanupErrors.push(errorCode(error));
      }
    }
    if (cleanupErrors.length) throw new Error(cleanupErrors[0]);
    const stopped = await record(session, "stopped", {
      livekitEgressId: egressId,
      youtubeBroadcastId: broadcastId,
      providerStep: "stopped",
      youtubeBroadcastCreateState: broadcastId ? "ready" : "none",
      youtubeStreamCreateState: streamId ? "ready" : "none",
      livekitEgressCreateState: egressId ? "ready" : "none",
    });
    return stopped
      ? safe(stopped)
      : { desiredState: "stopped", status: "stopping" };
  } catch (error) {
    const failed = await record(session, "failed", {
      errorCode: errorCode(error),
    }).catch(() => undefined);
    return failed
      ? safe(failed)
      : safe({ ...session, status: "failed", lastErrorCode: errorCode(error) });
  }
}
