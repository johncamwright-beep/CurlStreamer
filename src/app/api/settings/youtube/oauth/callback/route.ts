import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireYouTubeManager } from "@/lib/youtube-route-auth";
import {
  completeYouTubeConnection,
  consumeYouTubeOAuth,
} from "@/lib/youtube-connection";
import {
  exchangeYouTubeCode,
  loadOwnedYouTubeChannel,
  youtubeConfiguration,
} from "@/lib/providers/youtube";
import { encryptYouTubeRefreshToken } from "@/lib/providers/youtube-credential-vault";
import {
  hashYouTubeOAuthState,
  matchesYouTubeOAuthState,
  openYouTubeOAuthState,
  YOUTUBE_OAUTH_COOKIE,
} from "@/lib/youtube-oauth-state";

export const dynamic = "force-dynamic";
const querySchema = z.object({
  state: z.string().min(32),
  code: z.string().min(1).optional(),
  error: z.string().max(100).optional(),
});

function settingsRedirect(request: Request, result: string) {
  const target = new URL("/settings/youtube", request.url);
  target.searchParams.set("result", result);
  return NextResponse.redirect(target);
}

export async function GET(request: NextRequest) {
  const user = await requireYouTubeManager();
  if (!user) return settingsRedirect(request, "forbidden");
  let result = "connection_failed";
  try {
    const configuration = youtubeConfiguration();
    const configuredCallback = new URL(configuration.redirectUri);
    const receivedCallback = new URL(request.url);
    if (
      configuredCallback.origin !== receivedCallback.origin ||
      configuredCallback.pathname !== receivedCallback.pathname
    )
      throw new Error("youtube_configuration_unavailable");
    const query = querySchema.parse(
      Object.fromEntries(receivedCallback.searchParams.entries()),
    );
    const cookie = request.cookies.get(YOUTUBE_OAUTH_COOKIE)?.value;
    if (!cookie) throw new Error("youtube_oauth_expired");
    const state = openYouTubeOAuthState(cookie, user.id);
    if (!matchesYouTubeOAuthState(state.state, query.state))
      throw new Error("youtube_oauth_expired");
    const attempt = await consumeYouTubeOAuth(
      user,
      hashYouTubeOAuthState(query.state),
    );
    if (
      attempt.organization_id !== state.organizationId ||
      attempt.expected_version !== state.expectedVersion
    )
      throw new Error("youtube_oauth_expired");
    if (query.error || !query.code) {
      result = "cancelled";
    } else {
      const tokens = await exchangeYouTubeCode(
        query.code,
        state.verifier,
        fetch,
        configuration,
      );
      const channel = await loadOwnedYouTubeChannel(tokens.access_token);
      await completeYouTubeConnection(user, {
        organizationId: state.organizationId,
        expectedVersion: state.expectedVersion,
        encryptedCredentials: encryptYouTubeRefreshToken(
          tokens.refresh_token!,
          state.organizationId,
        ),
        channelId: channel.id,
        channelTitle: channel.title,
      });
      result = "connected";
    }
  } catch (error) {
    result =
      error instanceof Error &&
      [
        "youtube_oauth_expired",
        "youtube_reconnect_required",
        "youtube_scope_missing",
        "youtube_channel_selection_required",
      ].includes(error.message)
        ? error.message.replace("youtube_", "")
        : "connection_failed";
  }
  const response = settingsRedirect(request, result);
  response.cookies.set(YOUTUBE_OAUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/api/settings/youtube/oauth/callback",
    maxAge: 0,
  });
  return response;
}
