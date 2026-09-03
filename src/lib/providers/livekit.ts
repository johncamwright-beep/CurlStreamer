import "server-only";
import { SignJWT } from "jose";

export type LiveKitAccess = "camera-home" | "camera-away" | "organizer";

export function liveKitIdentity(gameId: string, access: LiveKitAccess) {
  return `${gameId}:${access}`;
}

export function liveKitMetadata(access: LiveKitAccess) {
  return JSON.stringify({
    cameraRole: access === "organizer" ? null : access,
  });
}

export function liveKitVideoGrant(gameId: string, access: LiveKitAccess) {
  const camera = access !== "organizer";
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
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret)
    throw new Error("LiveKit server configuration is incomplete");

  // Camera identities are stable so a reconnect replaces, rather than adds, a
  // publisher. Broadcast consumers remain unique because a page currently has
  // one subscriber Room for each displayed role.
  const identity =
    access === "organizer"
      ? `broadcast-${crypto.randomUUID()}`
      : liveKitIdentity(gameId, access);
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
    .setExpirationTime("10m")
    .sign(new TextEncoder().encode(secret));
  return { url, token };
}

function liveKitHttpUrl(url: string) {
  return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

/** Server-only administrative removal; a missing participant is already disconnected. */
export async function removeCameraParticipant(
  gameId: string,
  role: "camera-home" | "camera-away",
) {
  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret)
    throw new Error("LiveKit server configuration is incomplete");
  const token = await new SignJWT({
    video: { room: `game-${gameId}`, roomAdmin: true },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(key)
    .setSubject("curlcast-organizer")
    .setIssuedAt()
    .setExpirationTime("1m")
    .sign(new TextEncoder().encode(secret));
  const response = await fetch(
    `${liveKitHttpUrl(url)}/twirp/livekit.RoomService/RemoveParticipant`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        room: `game-${gameId}`,
        identity: liveKitIdentity(gameId, role),
      }),
    },
  );
  if (response.ok || response.status === 404) return;
  throw new Error(`LiveKit participant removal failed (${response.status})`);
}
