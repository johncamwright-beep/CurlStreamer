"use client";
import { useStudioSession } from "./StudioSessionProvider";
export function StudioPreviewStatus({ gameId }: { gameId: string }) {
  const session = useStudioSession();
  // Native program frames carry their own full-width replay/transition banner.
  if (
    session?.gameId === gameId &&
    session.replay &&
    session.replay.state >= 4 &&
    session.replay.state <= 6
  )
    return null;
  const live =
    session?.gameId === gameId && session.live && session.outputActive;
  return (
    <span className="studio-preview-status" data-live={Boolean(live)}>
      {live ? "LIVE" : "PREVIEW"}
    </span>
  );
}
