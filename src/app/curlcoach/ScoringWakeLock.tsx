"use client";
import { useEffect, useState } from "react";
export default function ScoringWakeLock({ active }: { active: boolean }) {
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState("Requesting…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!active || !enabled) return;
    let stopped = false;
    let pending = false;
    let lock: WakeLockSentinel | undefined;
    async function acquire() {
      if (
        stopped ||
        pending ||
        document.visibilityState !== "visible" ||
        (lock && !lock.released)
      )
        return;
      if (!navigator.wakeLock) {
        setStatus("Unavailable on this browser");
        return;
      }
      pending = true;
      try {
        const next = await navigator.wakeLock.request("screen");
        if (stopped) {
          await next.release();
          return;
        }
        lock = next;
        setStatus("Screen staying awake");
        next.addEventListener("release", () => {
          if (!stopped) setStatus("Paused — tap Retry");
        });
      } catch {
        if (!stopped) setStatus("Unavailable — tap Retry");
      } finally {
        pending = false;
      }
    }
    const visible = () => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", visible);
    void acquire();
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", visible);
      void lock?.release().catch(() => {});
    };
  }, [active, enabled, retry]);
  return (
    <div className="coach-wake-control">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Keep screen awake
      </label>
      <small role="status">{!enabled ? "Off" : status}</small>
      {enabled && status !== "Screen staying awake" && (
        <button
          type="button"
          onClick={() => {
            setStatus("Requesting…");
            setRetry((n) => n + 1);
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
}
