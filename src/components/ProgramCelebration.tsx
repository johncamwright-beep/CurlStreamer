"use client";
import React, { useCallback, useEffect, useState } from "react";
import { PlayerCelebration } from "./PlayerCelebration";
import type { CelebrationCue } from "@/lib/player-celebrations";

const consumed = new Set<string>();
/** Native output owns sound; previews use the same preloaded composition silently. */
export function ProgramCelebration({
  cue,
  gameId,
  nativeAudio = false,
}: {
  cue?: CelebrationCue;
  gameId: string;
  nativeAudio?: boolean;
}) {
  const [readyCue, setReadyCue] = useState<CelebrationCue | null>(null);
  const key = "curlcast-celebration:" + gameId + ":output";
  useEffect(() => {
    if (!cue?.headshotUrl || cue.expiresAt <= Date.now()) {
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
      (consumed.has(key + ":" + cue.id) || previous === cue.id)
    ) {
      setReadyCue(null);
      return;
    }
    setReadyCue(cue);
    const timer = setTimeout(
      () => setReadyCue(null),
      Math.max(0, cue.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [cue?.id, cue?.headshotUrl, key, nativeAudio]);
  const started = useCallback(() => {
    if (!cue || cue.expiresAt <= Date.now()) return false;
    if (!nativeAudio) return true;
    const identity = key + ":" + cue.id;
    if (consumed.has(identity)) return false;
    try {
      if (sessionStorage.getItem(key) === cue.id) return false;
    } catch {
      /* optional persistence */
    }
    consumed.add(identity);
    try {
      sessionStorage.setItem(key, cue.id);
    } catch {
      /* optional reload guard */
    }
    return true;
  }, [nativeAudio, cue?.id, key]);
  return (
    <PlayerCelebration
      cue={cue?.id === readyCue?.id ? readyCue : null}
      nativeAudio={nativeAudio}
      onStart={started}
    />
  );
}
