"use client";
import { useEffect, useState } from "react";
import { z } from "zod";

const stateSchema = z.object({
  gameId: z.string(),
  available: z.boolean(),
  busy: z.boolean(),
  streaming: z.string(),
  live: z.boolean(),
  receiving: z.boolean(),
  message: z.string().max(300),
});
export function StudioYouTube({ id }: { id: string }) {
  const [state, setState] = useState<z.infer<typeof stateSchema>>();
  const [pending, setPending] = useState(false);
  useEffect(() => {
    let last = 0;
    const receive = (event: Event) => {
      const parsed = stateSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== id) return;
      last = Date.now();
      setState(parsed.data);
      setPending(false);
    };
    window.addEventListener("studio-youtube-status", receive);
    const timer = setInterval(() => {
      if (Date.now() - last > 6000) {
        setState(undefined);
        setPending(false);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("studio-youtube-status", receive);
    };
  }, [id]);
  function send(action: "start" | "stop") {
    const bridge = (
      window as unknown as {
        chrome?: { webview?: { postMessage(value: unknown): void } };
      }
    ).chrome?.webview;
    if (!bridge || pending || !state || state.busy) return;
    setPending(true);
    bridge.postMessage({ type: `studio-youtube-${action}`, gameId: id });
  }
  const active =
    state && ["starting", "armed", "stopping"].includes(state.streaming);
  return (
    <section
      className="scoring-card studio-youtube"
      aria-label="YouTube broadcast"
    >
      <div className="scoring-section-heading">
        <h2 className="flex items-center gap-2">
          <svg width="32" height="24" viewBox="0 0 32 24" aria-hidden="true">
            <rect x="1" y="2" width="30" height="20" rx="6" fill="#ff0033" />
            <path d="m13 7 9 5-9 5z" fill="white" />
          </svg>
          YouTube
        </h2>
        <strong
          role="status"
          className={state?.live ? "text-red-400" : "text-slate-300"}
        >
          {state?.live
            ? "● LIVE"
            : state?.receiving
              ? "Receiving video"
              : active
                ? "Connecting…"
                : "Not live"}
        </strong>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className="btn"
          disabled={!state?.available || state.busy || pending}
          onClick={() => send(active ? "stop" : "start")}
        >
          {pending || state?.busy
            ? "Please wait…"
            : active
              ? "Stop YouTube"
              : "Broadcast to YouTube"}
        </button>
        <a className="btn-secondary" href="/settings/youtube">
          YouTube account
        </a>
      </div>
      {state?.receiving && !state.live && (
        <p className="mt-2 text-sm">
          Video is reaching YouTube.{" "}
          <a
            href="https://studio.youtube.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Open YouTube Studio to go live.
          </a>
        </p>
      )}
      {(!state?.available || state?.message) && (
        <p className="mt-2 text-sm text-slate-300">
          {state?.message || "Preparing Studio’s YouTube connection…"}
        </p>
      )}
    </section>
  );
}
