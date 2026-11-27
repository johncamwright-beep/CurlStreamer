"use client";
import { useEffect } from "react";

/** Keep the screen awake during active charting, where supported by the browser. */
export default function ScoringWakeLock({ active }: { active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let pending = false;
    let lock: WakeLockSentinel | undefined;
    async function acquire() {
      if (
        stopped ||
        pending ||
        document.visibilityState !== "visible" ||
        (lock && !lock.released) ||
        !navigator.wakeLock
      )
        return;
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped) {
          await next.release();
          return;
        }
        lock = next;
      } catch {
        /* Browser or battery policy can deny a wake lock. Retry on interaction. */
      } finally {
        pending = false;
      }
    }
    const retry = () => {
      void acquire();
    };
    document.addEventListener("visibilitychange", retry);
    document.addEventListener("pointerdown", retry);
    document.addEventListener("keydown", retry);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", retry);
      document.removeEventListener("pointerdown", retry);
      document.removeEventListener("keydown", retry);
      void lock?.release().catch(() => {});
    };
  }, [active]);
  return null;
}
