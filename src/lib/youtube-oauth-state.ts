import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  decryptYouTubeOAuthCookie,
  encryptYouTubeOAuthCookie,
} from "@/lib/providers/youtube-credential-vault";

export const YOUTUBE_OAUTH_COOKIE = "curlstreamer_youtube_oauth";

const payloadSchema = z.object({
  state: z.string().min(32),
  verifier: z.string().min(32),
  userId: z.uuid(),
  organizationId: z.uuid(),
  expectedVersion: z.number().int().nonnegative(),
  expiresAt: z.number().int().positive(),
});
export type YouTubeOAuthState = z.infer<typeof payloadSchema>;

export function hashYouTubeOAuthState(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export function sealYouTubeOAuthState(payload: YouTubeOAuthState) {
  return encryptYouTubeOAuthCookie(JSON.stringify(payload), payload.userId);
}

export function openYouTubeOAuthState(value: string, userId: string) {
  const payload = payloadSchema.parse(
    JSON.parse(decryptYouTubeOAuthCookie(value, userId)),
  );
  if (payload.userId !== userId || payload.expiresAt <= Date.now())
    throw new Error("youtube_oauth_expired");
  return payload;
}

export function matchesYouTubeOAuthState(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}
