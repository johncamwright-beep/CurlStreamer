import "server-only";

import { z } from "zod";

const tokenSchema = z.string().min(1).max(16_384);
const errorSchema = z.object({ error: z.literal("invalid_token") });

/** Revoke the entire Google grant without placing credentials in URLs or logs. */
export async function revokeYouTubeRefreshToken(
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!tokenSchema.safeParse(refreshToken).success)
    throw new Error("youtube_revocation_failed");
  try {
    const response = await fetcher("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
      redirect: "error",
    });
    if (response.status === 200) return;
    // A prior revoke may have succeeded even if its response or the subsequent
    // database cleanup failed. Google's invalid_token response makes retry safe.
    if (response.status === 400 && (await isAlreadyRevoked(response))) return;
    throw new Error("youtube_revocation_failed");
  } catch {
    // Provider errors may echo tokens. Expose only this fixed diagnostic.
    throw new Error("youtube_revocation_failed");
  }
}

async function isAlreadyRevoked(response: Response): Promise<boolean> {
  const reader = response.body?.getReader();
  if (!reader) return false;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > 4_096) {
      await reader.cancel();
      return false;
    }
    chunks.push(value);
  }
  try {
    return errorSchema.safeParse(
      JSON.parse(Buffer.concat(chunks).toString("utf8")),
    ).success;
  } catch {
    return false;
  }
}
