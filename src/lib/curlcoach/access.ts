import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { gameId, organizationId } from "./model";

import { labEnabled } from "./config";
export { labEnabled } from "./config";
export const sessionCookie = "curlcoach-lab-session";
function secret() {
  return new TextEncoder().encode(process.env.CURLCOACH_LAB_SECRET!);
}
export async function issueSession() {
  if (!labEnabled()) throw new Error("Unavailable");
  return new SignJWT({ organizationId, gameId, role: "coach" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("synthetic-coach")
    .setIssuer("curlcoach-local")
    .setAudience("curlcoach-lab")
    .setIssuedAt()
    .setExpirationTime("4h")
    .sign(secret());
}
export async function authorized(token?: string) {
  if (!labEnabled() || !token) return false;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
      issuer: "curlcoach-local",
      audience: "curlcoach-lab",
    });
    return (
      payload.organizationId === organizationId &&
      payload.gameId === gameId &&
      payload.role === "coach" &&
      payload.sub === "synthetic-coach"
    );
  } catch {
    return false;
  }
}
export function sameOrigin(request: Request) {
  const url = new URL(request.url);
  // Next may normalize the internal URL to localhost even when the browser
  // uses 127.0.0.1. Compare against the actual request Host, not forwarded headers.
  return (
    request.headers.get("origin") ===
    `${url.protocol}//${request.headers.get("host") ?? url.host}`
  );
}
