import "server-only";
import { SignJWT } from "jose";

export type LiveKitAccess = "camera-home" | "camera-away" | "organizer";

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

  const identity =
    access === "organizer"
      ? `broadcast-${crypto.randomUUID()}`
      : `${access}-${crypto.randomUUID()}`;
  const token = await new SignJWT({ video: liveKitVideoGrant(gameId, access) })
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
