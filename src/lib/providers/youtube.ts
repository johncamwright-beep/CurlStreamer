import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";

export const YOUTUBE_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";
const REQUEST_TIMEOUT_MS = 8_000;

const tokenSchema = z.object({
  access_token: z.string().min(1).max(16_384),
  refresh_token: z.string().min(1).max(16_384).optional(),
  scope: z.string().optional(),
});
const channelsSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().min(1).max(128),
      snippet: z.object({ title: z.string().min(1).max(200) }),
    }),
  ),
});

export type YouTubeConfiguration = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type YouTubeChannel = { id: string; title: string };

export function youtubeConfigurationStatus() {
  try {
    youtubeConfiguration();
    const key = process.env.YOUTUBE_CREDENTIAL_ENCRYPTION_KEY;
    return Boolean(key && Buffer.from(key, "base64").length === 32);
  } catch {
    return false;
  }
}

export function youtubeConfiguration(): YouTubeConfiguration {
  const parsed = z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      redirectUri: z.url(),
    })
    .safeParse({
      clientId: process.env.GOOGLE_YOUTUBE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_YOUTUBE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_YOUTUBE_REDIRECT_URI,
    });
  if (!parsed.success) throw new Error("youtube_configuration_unavailable");
  const url = new URL(parsed.data.redirectUri);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(url.hostname)
    )
  )
    throw new Error("youtube_configuration_unavailable");
  return parsed.data;
}

export function createYouTubePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createYouTubeAuthorizationUrl(
  state: string,
  challenge: string,
  configuration = youtubeConfiguration(),
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    response_type: "code",
    scope: YOUTUBE_SCOPE,
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return url;
}

async function googleRequest(
  url: string,
  init: RequestInit,
  fetcher: typeof fetch,
  authorizationFailure = false,
) {
  try {
    const response = await fetcher(url, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) {
      if (response.status >= 500 || response.status === 429)
        throw new Error("youtube_provider_unavailable");
      const codes = await boundedGoogleErrorCodes(response);
      if (
        codes.some((code) =>
          [
            "quotaExceeded",
            "dailyLimitExceeded",
            "rateLimitExceeded",
            "userRateLimitExceeded",
            "RESOURCE_EXHAUSTED",
          ].includes(code),
        )
      )
        throw new Error("youtube_provider_unavailable");
      if (
        codes.includes("invalid_grant") ||
        (authorizationFailure && [401, 403].includes(response.status))
      )
        throw new Error("youtube_reconnect_required");
      throw new Error("youtube_provider_rejected");
    }
    return response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      [
        "youtube_provider_rejected",
        "youtube_provider_unavailable",
        "youtube_reconnect_required",
      ].includes(error.message)
    )
      throw error;
    throw new Error("youtube_provider_unavailable");
  }
}

async function boundedGoogleErrorCodes(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return [];
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total <= 4_096) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4_096) {
      await reader.cancel();
      return [];
    }
    chunks.push(value);
  }
  try {
    const payload = JSON.parse(
      new TextDecoder().decode(Buffer.concat(chunks)),
    ) as unknown;
    if (!payload || typeof payload !== "object") return [];
    const error = (payload as { error?: unknown }).error;
    if (typeof error === "string") return [error];
    if (!error || typeof error !== "object") return [];
    const value = error as { status?: unknown; errors?: unknown };
    const codes = typeof value.status === "string" ? [value.status] : [];
    if (Array.isArray(value.errors))
      for (const item of value.errors) {
        const reason =
          item && typeof item === "object"
            ? (item as { reason?: unknown }).reason
            : null;
        if (typeof reason === "string") codes.push(reason);
      }
    return codes.slice(0, 8);
  } catch {
    return [];
  }
}

export async function exchangeYouTubeCode(
  code: string,
  verifier: string,
  fetcher: typeof fetch = fetch,
  configuration = youtubeConfiguration(),
) {
  const value = tokenSchema.parse(
    await googleRequest(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          redirect_uri: configuration.redirectUri,
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
        }),
      },
      fetcher,
    ),
  );
  if (!value.refresh_token) throw new Error("youtube_reconnect_required");
  if (!value.scope?.split(" ").includes(YOUTUBE_SCOPE))
    throw new Error("youtube_scope_missing");
  return value;
}

export async function refreshYouTubeAccessToken(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
  configuration = youtubeConfiguration(),
) {
  return tokenSchema.parse(
    await googleRequest(
      "https://oauth2.googleapis.com/token",
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: configuration.clientId,
          client_secret: configuration.clientSecret,
          grant_type: "refresh_token",
          refresh_token: refreshToken,
        }),
      },
      fetcher,
      true,
    ),
  ).access_token;
}

export async function loadOwnedYouTubeChannel(
  accessToken: string,
  fetcher: typeof fetch = fetch,
) {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.search = new URLSearchParams({
    part: "id,snippet,status",
    mine: "true",
  }).toString();
  const value = channelsSchema.parse(
    await googleRequest(
      url.toString(),
      { headers: { authorization: `Bearer ${accessToken}` } },
      fetcher,
      true,
    ),
  );
  if (value.items.length !== 1)
    throw new Error("youtube_channel_selection_required");
  return { id: value.items[0].id, title: value.items[0].snippet.title };
}
