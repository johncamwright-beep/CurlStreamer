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
    if (credentials) {
      const reconnect =
        error instanceof Error &&
        [
          "youtube_provider_rejected",
          "youtube_reconnect_required",
          "youtube_credentials_unavailable",
          "youtube_channel_selection_required",
        ].includes(error.message);
      await finishYouTubeConnectionTest(
        user,
        credentials.organization_id,
        credentials.connection_version,
        false,
        reconnect ? "reconnect_required" : "test_unavailable",
      ).catch(() => undefined);
    }
    return NextResponse.json(
      { error: "YouTube connection test failed" },
      { status: 409 },
    );
  }
}
