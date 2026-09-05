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

export function liveKitIdentity(
  gameId: string,
  access: LiveKitAccess,
  assignmentGeneration?: number,
) {
  const generation =
    cameraAccess(access) && assignmentGeneration && assignmentGeneration > 0
      ? `:g${assignmentGeneration}`
      : "";
  return `${gameId}:${access}${generation}`;
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
export async function issueLiveKitToken(
  gameId: string,
  access: LiveKitAccess,
  assignmentGeneration?: number,
) {
  const { url, key, secret } = liveKitConfiguration();

  // Camera identities are stable so a reconnect replaces, rather than adds, a
  // publisher. Broadcast consumers remain unique because a page currently has
  // one subscriber Room for each displayed role.
  const identity = cameraAccess(access)
    ? liveKitIdentity(gameId, access, assignmentGeneration)
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
  assignmentGeneration?: number,
) {
  await roomServiceRequest("RemoveParticipant", gameId, {
    room: `game-${gameId}`,
    identity: liveKitIdentity(gameId, role, assignmentGeneration),
  });
}

export type CameraIdentityGenerations = Partial<
  Record<"camera-home" | "camera-away", readonly number[]>
>;

/** Disconnects the room and asks LiveKit to revoke every recorded camera identity. */
export async function terminateGameLiveKit(
  gameId: string,
  generations: CameraIdentityGenerations = {},
) {
  const identities = (["camera-home", "camera-away"] as const).flatMap(
    (role) => [
      liveKitIdentity(gameId, role),
      ...[...new Set(generations[role] ?? [])]
        .filter((generation) => generation > 0)
        .map((generation) => liveKitIdentity(gameId, role, generation)),
    ],
  );
  const removals = await Promise.allSettled(
    identities.map((identity) =>
      roomServiceRequest("RemoveParticipant", gameId, {
        room: `game-${gameId}`,
        identity,
      }),
    ),
  );
  // Wait for explicit identity removal before deleting the room. LiveKit Cloud
  // documents identity removal as token revocation; DeleteRoom alone is only
  // room teardown and is not treated as token-revocation evidence.
  const failedRemovals = removals.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedRemovals)
    throw new Error(
      `LiveKit cleanup was not confirmed for ${failedRemovals} identity operation${failedRemovals === 1 ? "" : "s"}`,
    );
  await roomServiceRequest("DeleteRoom", gameId, {
    room: `game-${gameId}`,
  });
}
