"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlayerCelebration } from "./PlayerCelebration";
import {
  getCelebrationTemplate,
  type CelebrationCue,
} from "@/lib/player-celebrations";
import type { ConnectionDiagnostic } from "@/lib/providers/connection-diagnostics";

const consumed = new Set<string>();
/** Native output owns sound; previews use the same preloaded composition silently. */
export function ProgramCelebration({
  cue,
  gameId,
  nativeAudio = false,
  diagnostic,
  stopped = false,
}: {
  cue?: CelebrationCue;
  gameId: string;
  nativeAudio?: boolean;
  diagnostic?: ConnectionDiagnostic;
  stopped?: boolean;
}) {
  const [readyCue, setReadyCue] = useState<CelebrationCue | null>(null);
  const readyGame = useRef(gameId);
  const key = "curlcast-celebration:" + gameId + ":output";
  useEffect(() => {
    // Native output owns its playback clock. A cloud cue expiring is not a
    // Stop command: keep a clip that arrived late long enough to finish once.
    const sameGame = readyGame.current === gameId;
    readyGame.current = gameId;
    const next = cue ?? (nativeAudio && sameGame ? readyCue : null);
    if (stopped || !next?.headshotUrl || (cue && cue.expiresAt <= Date.now())) {
      setReadyCue(null);
      return;
    }
    let previous: string | null = null;
    try {
      previous = sessionStorage.getItem(key);
    } catch {
      /* memory guard remains available */
    }
    if (
      nativeAudio &&
      cue &&
      (consumed.has(key + ":" + cue.id) || previous === cue.id)
    ) {
      setReadyCue(null);
      return;
    }
    setReadyCue(next);
    const timer = setTimeout(
      () => setReadyCue(null),
      Math.max(
        0,
        next.expiresAt -
          Date.now() +
          (nativeAudio
            ? getCelebrationTemplate(next.templateId).durationMs
            : 0),
      ),
    );
    return () => clearTimeout(timer);
  }, [cue?.id, cue?.headshotUrl, key, nativeAudio, stopped]);
  const started = useCallback(() => {
    if (stopped || !readyCue || readyCue.expiresAt <= Date.now()) return false;
    if (!nativeAudio) return true;
    const identity = key + ":" + readyCue.id;
    if (consumed.has(identity)) return false;
    try {
      if (sessionStorage.getItem(key) === readyCue.id) return false;
    } catch {
      /* optional persistence */
    }
    consumed.add(identity);
    try {
      sessionStorage.setItem(key, readyCue.id);
    } catch {
      /* optional reload guard */
    }
    return true;
  }, [nativeAudio, readyCue, key, stopped]);
  return (
    <PlayerCelebration
      cue={
        !stopped &&
        readyGame.current === gameId &&
        (nativeAudio || cue?.id === readyCue?.id)
          ? readyCue
          : null
      }
      nativeAudio={nativeAudio}
      startWhenReady={nativeAudio}
      onStart={started}
      onFinished={() => setReadyCue(null)}
      onReady={() =>
        diagnostic?.({
          layer: "celebration",
          code: "playback_ready",
          trace: readyCue?.id,
        })
      }
      onPlaying={() =>
        diagnostic?.({
          layer: "celebration",
          code: "playback_started",
          trace: readyCue?.id,
        })
      }
      onError={(message) =>
        diagnostic?.({
          layer: "celebration",
          code: /too late|not ready in time/.test(message)
            ? "playback_late"
            : "playback_failed",
          trace: readyCue?.id,
        })
      }
    />
  );
}
