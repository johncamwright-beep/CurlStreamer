"use client";

import { useEffect } from "react";
import { useStudioSession } from "./StudioSessionContext";

export function StudioShotFlagRelay({ gameId }: { gameId: string }) {
  const session = useStudioSession();
  const available =
    session?.active && session.gameId === gameId && session.canCaptureCoachClip;

  useEffect(() => {
    if (!available) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function connect() {
      try {
        const { serveShotFlagClips } =
          await import("@/lib/curlcoach/shot-flag-clip");
        await serveShotFlagClips(gameId, controller.signal);
      } catch {
        // Shot Tracker reports unavailable video when a capture is requested.
      }
      if (!controller.signal.aborted) timer = setTimeout(connect, 15_000);
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [available, gameId]);

  return null;
}
