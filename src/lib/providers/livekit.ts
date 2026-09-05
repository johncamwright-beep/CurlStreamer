import "server-only";
import { SignJWT } from "jose";

export type LiveKitAccess =
  | "camera-home"
  | "camera-away"
  | "organizer"
  | "broadcast-viewer"
  | "preview-subscriber"
  | "public-viewer";

export class LiveKitConfigurationError extends Error {
  readonly category = "configuration";
  constructor(readonly missingVariables: string[]) {
    super("LiveKit server configuration is incomplete");
  }
}

function liveKitConfiguration() {
  // NEXT_PUBLIC_LIVEKIT_URL is intentionally public and is the deployment
  // variable documented for clients. The key and secret remain server-only.
  const url = process.env.NEXT_PUBLIC_LIVEKIT_URL || process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  const missingVariables = [
    !url && "NEXT_PUBLIC_LIVEKIT_URL",
    !key && "LIVEKIT_API_KEY",
    !secret && "LIVEKIT_API_SECRET",
  ].filter((name): name is string => Boolean(name));
  if (missingVariables.length)
    throw new LiveKitConfigurationError(missingVariables);
  return { url: url!, key: key!, secret: secret! };
}

export function liveKitIdentity(gameId: string, access: LiveKitAccess) {
  return `${gameId}:${access}`;
}

export function liveKitMetadata(access: LiveKitAccess) {
  return JSON.stringify({
    cameraRole:
      access === "camera-home" || access === "camera-away" ? access : null,
  });
}

export function liveKitVideoGrant(gameId: string, access: LiveKitAccess) {
  const camera = access === "camera-home" || access === "camera-away";
  return {
    room: `game-${gameId}`,
    roomJoin: true,
    canPublish: camera,
    canSubscribe: !camera,
    canPublishData: false,
    ...(camera ? { canPublishSources: ["camera"] } : {}),
  };
}

/** Creates a short-lived room credential. This module must never be imported by a client. */
export async function issueLiveKitToken(gameId: string, access: LiveKitAccess) {
  const { url, key, secret } = liveKitConfiguration();

  // Camera identities are stable so a reconnect replaces, rather than adds, a
  // publisher. Broadcast consumers remain unique because a page currently has
  // one subscriber Room for each displayed role.
  const identity = cameraAccess(access)
    ? liveKitIdentity(gameId, access)
    : `${["broadcast-viewer", "public-viewer"].includes(access) ? "viewer" : "preview"}-${crypto.randomUUID()}`;
  const token = await new SignJWT({
    video: liveKitVideoGrant(gameId, access),
    metadata: liveKitMetadata(access),
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(key)
    .setSubject(identity)
    .setNotBefore("0s")
    .setIssuedAt()
    .setJti(crypto.randomUUID())
    .setExpirationTime(
      ["broadcast-viewer", "public-viewer"].includes(access) ? "5m" : "10m",
    )
    .sign(new TextEncoder().encode(secret));
  return { url, token };
}

function cameraAccess(
  access: LiveKitAccess,
): access is "camera-home" | "camera-away" {
  return access === "camera-home" || access === "camera-away";
}

function liveKitHttpUrl(url: string) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

async function roomServiceRequest(
  operation: "RemoveParticipant" | "DeleteRoom",
  gameId: string,
  body: Record<string, string>,
) {
  const { url, key, secret } = liveKitConfiguration();
  const token = await new SignJWT({
    video:
      operation === "DeleteRoom"
        ? { roomCreate: true }
        : { room: `game-${gameId}`, roomAdmin: true },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(key)
    .setSubject("curlcast-organizer")
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(secret));
  const response = await fetch(
    `${liveKitHttpUrl(url)}/twirp/livekit.RoomService/${operation}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
    },
  );
  if (response.ok || response.status === 404) return;
  throw new Error(`${operation} failed (${response.status})`);
}

/** Server-only administrative removal; a missing participant is already disconnected. */
export async function removeCameraParticipant(
  gameId: string,
  role: "camera-home" | "camera-away",
) {
  await roomServiceRequest("RemoveParticipant", gameId, {
    room: `game-${gameId}`,
    identity: liveKitIdentity(gameId, role),
  });
}

/** Disconnects the room and asks LiveKit to revoke both stable camera identities. */
export async function terminateGameLiveKit(gameId: string) {
  const removals = await Promise.allSettled([
    removeCameraParticipant(gameId, "camera-home"),
    removeCameraParticipant(gameId, "camera-away"),
  ]);
  // Wait for stable-identity removal before deleting the room; on LiveKit
  // Cloud this is the operation that revokes prior tokens for those identities.
  const deletion = await Promise.allSettled([
    roomServiceRequest("DeleteRoom", gameId, {
      room: `game-${gameId}`,
    }),
  ]);
  const operations = [...removals, ...deletion];
  const failed = operations
    .map((result, index) => (result.status === "rejected" ? index : -1))
    .filter((index) => index >= 0);
  if (failed.length)
    throw new Error(
      `LiveKit cleanup was not confirmed for ${failed.length} operation${failed.length === 1 ? "" : "s"}`,
    );
}
