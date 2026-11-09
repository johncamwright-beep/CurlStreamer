"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { StudioOverlay } from "./StudioOverlay";

import { studioCoachReviewStateSchema as stateSchema } from "@/lib/studio-session";
const bridge = () =>
  (
    window as Window & {
      chrome?: { webview?: { postMessage(value: unknown): void } };
    }
  ).chrome?.webview;
export function StudioCoachReview({ gameId }: { gameId: string }) {
  const [state, setState] = useState<z.infer<typeof stateSchema> | null>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<{
    nonce: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    setState(null);
    setOpen(false);
    const status = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      const parsed = stateSchema.safeParse(detail?.coachReview);
      const next =
        detail?.gameId === gameId && detail?.active && parsed.success
          ? parsed.data
          : null;
      setState(next);
      if (next)
        setHost((current) =>
          next.addresses.includes(current)
            ? current
            : (next.addresses[0] ?? ""),
        );
    };
    const result = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.gameId !== gameId || detail?.nonce !== pending.current?.nonce)
        return;
      clearTimeout(pending.current!.timer);
      pending.current = null;
      setBusy(false);
      if (!detail.ok)
        setError(
          "Could not open phone review. Check the local network and try again.",
        );
    };
    window.addEventListener("studio-session-status", status);
    window.addEventListener("studio-coach-review-result", result);
    bridge()?.postMessage({ type: "studio-session-observe" });
    return () => {
      window.removeEventListener("studio-session-status", status);
      window.removeEventListener("studio-coach-review-result", result);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [gameId]);
  function send(action: "start" | "stop") {
    if (!bridge() || pending.current) return;
    const nonce = crypto.randomUUID();
    setBusy(true);
    setError("");
    pending.current = {
      nonce,
      timer: setTimeout(() => {
        pending.current = null;
        setBusy(false);
        setError("Studio did not respond. Try again.");
      }, 20000),
    };
    bridge()!.postMessage({
      type: "studio-coach-review",
      gameId,
      nonce,
      action,
      ...(action === "start" ? { host } : {}),
    });
  }
  if (!state) return null;
  return (
    <>
      <button className="btn min-h-11 w-full" onClick={() => setOpen(true)}>
        Phone review
      </button>
      <StudioOverlay
        open={open}
        onClose={() => setOpen(false)}
        title="Phone review"
      >
        <p>
          Scrub locally on your phone, then return to Shot Tracker to choose the
          recorded shot and save its flag.
        </p>
        {state.address ? (
          <>
            <p>Open this address on your phone using the same Wi-Fi:</p>
            <p className="break-all">{state.address}</p>
            <p>
              Pairing code: <strong>{state.code}</strong>
            </p>
            <button
              className="btn min-h-11"
              disabled={busy}
              onClick={() => send("stop")}
            >
              Close phone access
            </button>
          </>
        ) : (
          <>
            <label>
              Router address
              <select
                className="min-h-11"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              >
                {state.addresses.map((ip) => (
                  <option key={ip}>{ip}</option>
                ))}
              </select>
            </label>
            <button
              className="btn min-h-11"
              disabled={busy || !host}
              onClick={() => send("start")}
            >
              {busy ? "Opening…" : "Open phone access"}
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </StudioOverlay>
    </>
  );
}
