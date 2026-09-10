"use client";
import { useEffect, useRef, useState } from "react";
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
  const [autoGoLive, setAutoGoLive] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [error, setError] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const flight = useRef(false);
  async function goLive() {
    if (flight.current) return;
    flight.current = true;
    setAutoGoLive(false);
    setGoingLive(true);
    setError("");
    try {
      const result = await fetch(`/api/games/${id}/studio-m4`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "go-live" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!result.ok) throw Error();
    } catch {
      setError(
        "YouTube has not confirmed going live. Keep Studio open and try Go live again.",
      );
    } finally {
      flight.current = false;
      setGoingLive(false);
    }
  }
  useEffect(() => {
    if (autoGoLive && state?.receiving && !state.live && !state.busy)
      void goLive();
  }, [autoGoLive, state]);
  useEffect(() => {
    setWatchUrl("");
    setCopied(false);
    setCopyError("");
    if (!state?.live) return;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`/api/games/${id}/studio-m4`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const result = z
          .object({
            watchUrl: z
              .string()
              .regex(
                /^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/,
              ),
          })
          .safeParse(await response.json());
        if (result.success && !controller.signal.aborted)
          setWatchUrl(result.data.watchUrl);
      } catch {
        /* Retry while live; never display an unverified destination. */
      }
    }
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, state?.live]);
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
    setAutoGoLive(action === "start");
    setError("");
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
        <div className="mt-2 flex items-center gap-2 text-sm">
          {goingLive || autoGoLive ? (
            "Going live on YouTube…"
          ) : (
            <button className="btn-secondary" onClick={() => void goLive()}>
              Go live
            </button>
          )}
        </div>
      )}
      {error && !state?.live && (
        <p role="alert" className="mt-2 text-sm text-amber-200">
          {error}
        </p>
      )}
      {state?.live && watchUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <a
            className="min-w-0 break-all underline"
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
          >
            {watchUrl}
          </a>
          <button
            className="btn-secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(watchUrl);
                setCopied(true);
                setCopyError("");
              } catch {
                setCopied(false);
                setCopyError(
                  "Copy was unavailable. Select the live link to copy it.",
                );
              }
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}
      {state?.live && copyError && <p role="alert">{copyError}</p>}
      {(!state?.available || state?.message) && (
        <p className="mt-2 text-sm text-slate-300">
          {state?.message || "Preparing Studio’s YouTube connection…"}
        </p>
      )}
    </section>
  );
}
