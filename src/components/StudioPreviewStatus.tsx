"use client";
import { useStudioSession } from "./StudioSessionProvider";
export function StudioPreviewStatus({ gameId }: { gameId: string }) {
  const session = useStudioSession();
  const live =
    session?.gameId === gameId && session.live && session.outputActive;
  return (
    <span className="studio-preview-status" data-live={Boolean(live)}>
      {live ? "LIVE" : "PREVIEW"}
    </span>
  );
}
