import { NextResponse } from "next/server";
import { requireYouTubeManager, isSameOrigin } from "@/lib/youtube-route-auth";
import {
  finishYouTubeConnectionTest,
  getYouTubeCredentials,
} from "@/lib/youtube-connection";
import {
  loadOwnedYouTubeChannel,
  refreshYouTubeAccessToken,
  youtubeConfiguration,
} from "@/lib/providers/youtube";
import { decryptYouTubeRefreshToken } from "@/lib/providers/youtube-credential-vault";

export const dynamic = "force-dynamic";

function testFailure(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case "youtube_reconnect_required":
      return {
        code,
        error:
          "Google authorization expired or was revoked. Reconnect this channel in your regular browser, then test again.",
        reconnect: true,
      };
    case "youtube_scope_missing":
      return {
        code,
        error:
          "Google has not granted the required YouTube permissions. Reconnect this channel in your regular browser and approve the requested permissions.",
        reconnect: true,
      };
    case "youtube_channel_selection_required":
      return {
        code,
        error:
          "Google did not return one authorized YouTube channel. Reconnect in your regular browser and choose the account that owns the team's channel.",
        reconnect: true,
      };
    case "youtube_credentials_unavailable":
      return {
        code,
        error:
          "CurlStreamer could not read the saved YouTube authorization. Reconnect this channel in your regular browser. If this continues, contact CurlStreamer support.",
        reconnect: true,
      };
    case "youtube_quota_exceeded":
      return {
        code,
        error:
          "YouTube's API limit has been reached. Wait for API access to become available before testing or starting a broadcast. Your saved channel has been kept.",
        reconnect: false,
      };
    case "youtube_live_permission_blocked":
      return {
        code,
        error:
          "YouTube is blocking live broadcasts on this channel. Check the channel's live streaming permissions in YouTube Studio.",
        reconnect: false,
      };
    case "youtube_live_streaming_not_enabled":
      return {
        code,
        error:
          "Live streaming is not enabled on this YouTube channel. Enable it in YouTube Studio before starting a broadcast.",
        reconnect: false,
      };
    case "youtube_configuration_unavailable":
      return {
        code,
        error:
          "CurlStreamer's YouTube integration is not configured correctly. Contact CurlStreamer support; reconnecting your channel will not fix this server configuration issue.",
        reconnect: false,
      };
    case "youtube_provider_unavailable":
      return {
        code,
        error:
          "CurlStreamer could not reach Google's YouTube service. Try the connection test again shortly. Your saved channel has been kept.",
        reconnect: false,
      };
    case "youtube_provider_rejected":
      return {
        code,
        error:
          "Google rejected the YouTube channel check. Check the channel's permissions in YouTube Studio, or contact CurlStreamer support to check its Google API configuration.",
        reconnect: false,
      };
    case "youtube_test_finish_failed":
      return {
        code,
        error:
          "The YouTube channel check could not be saved. Refresh YouTube Settings and test again.",
        reconnect: false,
      };
    default:
      return {
        code: "youtube_test_unavailable",
        error:
          "The YouTube connection test could not be completed. Try again shortly, or contact CurlStreamer support if this continues.",
        reconnect: false,
      };
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request))
    return NextResponse.json(
      { error: "Invalid request origin" },
      { status: 403 },
    );
  const user = await requireYouTubeManager();
  if (!user)
    return NextResponse.json(
      { error: "Team administrator access is required" },
      { status: 403 },
    );
  let credentials: Awaited<ReturnType<typeof getYouTubeCredentials>> | null =
    null;
  try {
    youtubeConfiguration();
    credentials = await getYouTubeCredentials(user);
    const refreshToken = decryptYouTubeRefreshToken(
      credentials.encrypted_credentials,
      credentials.organization_id,
    );
    const accessToken = await refreshYouTubeAccessToken(refreshToken);
    const channel = await loadOwnedYouTubeChannel(accessToken);
    if (channel.id !== credentials.channel_id) {
      await finishYouTubeConnectionTest(
        user,
        credentials.organization_id,
        credentials.connection_version,
        false,
        "channel_mismatch",
      );
      return NextResponse.json(
        {
          error:
            "The authorized YouTube channel no longer matches the saved channel",
          code: "channel_mismatch",
        },
        { status: 409 },
      );
    }
    await finishYouTubeConnectionTest(
      user,
      credentials.organization_id,
      credentials.connection_version,
      true,
      null,
    );
    return NextResponse.json({
      ok: true,
      message: "Connection verified. No broadcast was created or published.",
    });
  } catch (error) {
    const failure = testFailure(error);
    if (credentials) {
      await finishYouTubeConnectionTest(
        user,
        credentials.organization_id,
        credentials.connection_version,
        false,
        failure.reconnect ? "reconnect_required" : "test_unavailable",
      ).catch(() => undefined);
    }
    return NextResponse.json(
      {
        error: failure.error,
        code: failure.code,
      },
      { status: 409 },
    );
  }
}
