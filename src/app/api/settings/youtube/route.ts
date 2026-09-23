import { NextResponse } from "next/server";
import { disconnectYouTubeConnection } from "@/lib/youtube-connection";
import { isSameOrigin, requireYouTubeManager } from "@/lib/youtube-route-auth";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
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
  try {
    await disconnectYouTubeConnection(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error &&
          error.message === "youtube_connection_in_use"
            ? "An unfinished broadcast still uses this channel. Reconnect the same channel in your regular browser, then stop or recover that broadcast before disconnecting."
            : "YouTube connection could not be disconnected",
      },
      { status: 409 },
    );
  }
}
