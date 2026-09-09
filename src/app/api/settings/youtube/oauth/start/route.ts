import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireYouTubeManager } from "@/lib/youtube-route-auth";
import { beginYouTubeOAuth } from "@/lib/youtube-connection";
import {
  youtubeOAuthCallback,
  youtubeOAuthOrigin,
} from "@/lib/youtube-oauth-origin";
import {
  createYouTubeAuthorizationUrl,
  createYouTubePkce,
  youtubeConfiguration,
} from "@/lib/providers/youtube";
import {
  sealYouTubeOAuthState,
  YOUTUBE_OAUTH_COOKIE,
} from "@/lib/youtube-oauth-state";

export const dynamic = "force-dynamic";
const CALLBACK_PATH = "/api/settings/youtube/oauth/callback";

export async function GET(request: Request) {
  const user = await requireYouTubeManager();
  if (!user)
    return NextResponse.json(
      { error: "Team administrator access is required" },
      { status: 403 },
    );
  let stage:
    "configuration" | "callback_origin" | "oauth_begin" | "oauth_state" =
    "configuration";
  try {
    const configuration = youtubeConfiguration();
    stage = "callback_origin";
    const callback = youtubeOAuthCallback(
      configuration.redirectUri,
      youtubeOAuthOrigin(request),
    );
    stage = "oauth_state";
    const state = randomBytes(32).toString("base64url");
    const stateHash = createHash("sha256").update(state).digest("hex");
    const { verifier, challenge } = createYouTubePkce();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    stage = "oauth_begin";
    const attempt = await beginYouTubeOAuth(
      user,
      stateHash,
      new Date(expiresAt).toISOString(),
    );
    stage = "oauth_state";
    const response = NextResponse.redirect(
      createYouTubeAuthorizationUrl(state, challenge, configuration),
    );
    response.cookies.set(
      YOUTUBE_OAUTH_COOKIE,
      sealYouTubeOAuthState({
        state,
        verifier,
        userId: user.id,
        organizationId: attempt.organization_id,
        expectedVersion: attempt.expected_version,
        expiresAt,
      }),
      {
        httpOnly: true,
        secure: callback.protocol === "https:",
        sameSite: "lax",
        path: CALLBACK_PATH,
        maxAge: 10 * 60,
      },
    );
    return response;
  } catch {
    const code = `youtube_oauth_start_${stage}`;
    console.error("YouTube OAuth start failed", { code });
    return NextResponse.json(
      {
        error: "YouTube connection is not configured for this environment",
        code,
      },
      { status: 503 },
    );
  }
}
