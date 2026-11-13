"use client";
import { useStudioSession } from "./StudioSessionContext";

const labels = {
  preview: "PREVIEW",
  live: "LIVE",
  "live-paused": "LIVE · PAUSED",
  paused: "PAUSED",
  sending: "SENDING VIDEO",
  checking: "CHECKING STATUS",
  connecting: "Connecting…",
};
export type PreviewStatus = keyof typeof labels;

export function StudioPreviewStatus({
  gameId,
  broadcastStatus,
}: {
  gameId: string;
  broadcastStatus?: PreviewStatus;
}) {
  const current = useStudioSession();
  const session = current?.gameId === gameId ? current : null;
  // Native program frames carry their own full-width replay/transition banner.
  if (session?.replay && session.replay.state >= 4 && session.replay.state <= 6)
    return null;
  const paused = session?.presentation === "hold";
  const live = session?.live && session.outputActive;
  const status =
    broadcastStatus ??
    (live ? (paused ? "live-paused" : "live") : paused ? "paused" : "preview");
  return (
    <span
      className="studio-preview-status"
      role="status"
      data-live={status === "live" || status === "live-paused"}
      data-connecting={status === "connecting"}
    >
      {status === "connecting" ? (
        <>
          <span className="sr-only">{labels.connecting}</span>
          <span aria-hidden="true" className="studio-preview-connecting">
            Connecting<span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </>
      ) : (
        labels[status]
      )}
    </span>
  );
}
