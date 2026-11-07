"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { StudioOverlay } from "./StudioOverlay";
import { studioReplayStateSchema as replayState } from "@/lib/studio-session";

type Replay = z.infer<typeof replayState>;
function bridge() {
  return (
    window as Window & {
      chrome?: { webview?: { postMessage(value: unknown): void } };
    }
  ).chrome?.webview;
}
export function StudioReplay({ gameId }: { gameId: string }) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<Replay | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [start, setStart] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const wasPlaying = useRef(false);
  const pending = useRef<{
    nonce: string;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  useEffect(() => {
    setSupported(navigator.userAgent.includes("StudioReplay/1"));
    function status(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.gameId !== gameId || detail?.active !== true) {
        setState(null);
        return;
      }
      const parsed = replayState.safeParse(detail.replay);
      const next = parsed.success ? parsed.data : null;
      const onAir = !!next && next.state >= 4 && next.state <= 6;
      if (onAir || wasPlaying.current) setOpen(false);
      wasPlaying.current = onAir;
      setState(next);
    }
    function result(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.gameId !== gameId || detail?.nonce !== pending.current?.nonce)
        return;
      clearTimeout(pending.current!.timer);
      pending.current = null;
      setBusy(false);
      if (detail.ok !== true)
        setError(
          "Replay could not complete. Check the program preview and try again.",
        );
    }
    window.addEventListener("studio-session-status", status);
    window.addEventListener("studio-replay-result", result);
    bridge()?.postMessage({ type: "studio-session-observe" });
    return () => {
      window.removeEventListener("studio-session-status", status);
      window.removeEventListener("studio-replay-result", result);
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = null;
    };
  }, [gameId]);
  function send(action: "capture" | "play" | "cancel") {
    if (!bridge() || pending.current) return;
    if (action === "capture") setPreviewReady(false);
    const nonce = crypto.randomUUID();
    setBusy(true);
    setError("");
    pending.current = {
      nonce,
      timer: setTimeout(() => {
        pending.current = null;
        setBusy(false);
        setError(
          "Studio has not confirmed the replay action. Check the program preview before trying again.",
        );
      }, 20000),
    };
    bridge()!.postMessage({
      type: "studio-replay",
      gameId,
      nonce,
      action,
      ...(action === "play"
        ? { clipId: state?.clipId, startMs: Math.round(start) }
        : {}),
    });
  }
  const playing = !!state && state.state >= 4 && state.state <= 6;
  const ready = !busy && state?.state === 3 && !!state.clipId;
  const minimum = Math.max(0, (state?.durationMs ?? 0) - 60000);
  const maximum = Math.max(minimum, (state?.durationMs ?? 0) - 250);
  function seek(value: number) {
    setStart(value);
    if (video.current) {
      video.current.pause();
      video.current.currentTime = value / 1000;
    }
  }
  function close() {
    if (busy || !open) return;
    setOpen(false);
    if (!playing) send("cancel");
  }
  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        className="btn-secondary min-h-11"
        disabled={
          busy ||
          !state ||
          state.state === 0 ||
          state.state === 2 ||
          state.state === 7
        }
        onClick={() => {
          if (playing) send("cancel");
          else {
            setOpen(true);
            send("capture");
          }
        }}
      >
        {playing
          ? "Return Live"
          : state?.state === 0
            ? "Replay · buffering…"
            : state?.state === 7
              ? "Replay unavailable"
              : "Replay"}
      </button>
      {error && !open && <p role="alert">{error}</p>}
      <StudioOverlay
        title={playing ? "Replay on air" : "Choose replay start"}
        open={open}
        onClose={close}
        dismissible={!busy}
      >
        {error && <p role="alert">{error}</p>}
        {playing ? (
          <>
            <p role="status">
              REPLAY is on air. Studio will return live automatically.
            </p>
            <button
              type="button"
              className="btn min-h-11"
              disabled={busy}
              onClick={() => send("cancel")}
            >
              Return Live
            </button>
          </>
        ) : ready ? (
          <>
            <p>Live broadcast continues while you choose.</p>
            <video
              ref={video}
              key={state.clipId}
              src={`/__studio-replay/${gameId}/${state.clipId}`}
              muted
              playsInline
              preload="auto"
              style={{
                width: "100%",
                maxHeight: "min(34vh, 260px)",
                objectFit: "contain",
                background: "#000",
              }}
              onLoadedMetadata={() => {
                seek(maximum);
                setPreviewReady(true);
              }}
              onError={() =>
                setError(
                  "The replay preview could not load. Close this window and try again.",
                )
              }
            />
            <label className="block">
              Replay starts {((state.durationMs - start) / 1000).toFixed(1)}{" "}
              seconds before capture
              <input
                aria-label="Replay start"
                type="range"
                min={minimum}
                max={maximum}
                step={1}
                value={start}
                className="w-full min-h-11"
                onChange={(event) => seek(Number(event.target.value))}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {[15, 30, 45, 60].map((seconds) => (
                <button
                  type="button"
                  className="btn-secondary min-h-11"
                  key={seconds}
                  disabled={state.durationMs - minimum < seconds * 1000}
                  onClick={() => seek(state.durationMs - seconds * 1000)}
                >
                  {seconds}s
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn min-h-11 mt-3 w-full"
              disabled={
                busy ||
                !previewReady ||
                !!error ||
                start < minimum ||
                start > maximum
              }
              onClick={() => send("play")}
            >
              Play Replay
            </button>
          </>
        ) : (
          <p role="status">
            {state?.state === 7
              ? "Replay unavailable. Close this window and try again."
              : "Preparing replay…"}
          </p>
        )}
      </StudioOverlay>
    </>
  );
}
