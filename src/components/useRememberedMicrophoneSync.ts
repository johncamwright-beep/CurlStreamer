"use client";
import { useEffect, useRef, useState } from "react";
import {
  readMicrophoneSyncPreference,
  rememberMicrophoneSync,
  validMicrophoneSync,
} from "@/lib/microphone-sync-preference";

/** Seed once per game; polling must never overwrite an operator's adjustment. */
export function useRememberedMicrophoneSync(
  game: { id: string; programAudioDelayMs?: number } | undefined,
  enabled: boolean,
  act: (action: unknown) => Promise<void>,
) {
  const initialized = useRef<string | undefined>(undefined);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!game || !enabled || initialized.current === game.id) return;
    initialized.current = game.id;
    setError("");
    const remembered = readMicrophoneSyncPreference();
    if (validMicrophoneSync(game.programAudioDelayMs)) {
      // Upgrade existing profiles using their current game's saved calibration.
      // Visiting an older game must not replace a newer remembered preference.
      if (remembered === undefined)
        rememberMicrophoneSync(game.programAudioDelayMs);
      return;
    }
    if (remembered === undefined) return;
    let cancelled = false;
    void act({ type: "program-audio-delay", milliseconds: remembered }).catch(
      () => {
        if (!cancelled)
          setError(
            "Could not restore microphone sync. Set it in Camera Settings before broadcasting.",
          );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [game?.id, enabled, act]);
  return error;
}
