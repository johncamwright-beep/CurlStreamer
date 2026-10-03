import "server-only";
import { participantUrl } from "./participant-links";

/** Trust deployment configuration, never client-supplied forwarding headers. */
export function youtubeOAuthOrigin(request: Request): string {
  const received = new URL(request.url);
  if (!process.env.APP_BASE_URL && process.env.NODE_ENV !== "production")
    return received.origin;
  const canonical = new URL(
    participantUrl(request, "/", {
      NODE_ENV: "production",
      APP_BASE_URL: process.env.APP_BASE_URL,
    }),
  ).origin;
  // Next reconstructs its internal URL using forwarded HTTPS plus its loopback
  // bind hostname. Only the deployment origin determines redirects/cookies.
  const loopbackProxy =
    ["http:", "https:"].includes(received.protocol) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(received.hostname);
  if (received.origin !== canonical && !loopbackProxy)
    throw new Error("youtube_configuration_unavailable");
  return canonical;
}

export function youtubeOAuthCallback(redirectUri: string, origin: string): URL {
  const callback = new URL(redirectUri);
  if (
    callback.origin !== origin ||
    callback.pathname !== "/api/settings/youtube/oauth/callback" ||
    callback.username ||
    callback.password ||
    callback.search ||
    callback.hash
  )
    throw new Error("youtube_configuration_unavailable");
  return callback;
}
