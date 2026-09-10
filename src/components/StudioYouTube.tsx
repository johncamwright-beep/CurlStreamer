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
  const nextCheck = useRef(0);
  const failures = useRef(0);
  const halted = useRef(false);
  async function goLive() {
    if (flight.current) return;
    flight.current = true;
    nextCheck.current = Date.now() + 10000;
    setGoingLive(true);
    setError("");
    try {
      const result = await fetch(`/api/games/${id}/studio-m4`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "go-live" }),
        signal: AbortSignal.timeout(30000),
      });
      if (!result.ok) {
        if ([400, 401, 403, 409].includes(result.status)) halted.current = true;
        throw Error();
      }
      failures.current = 0;
      const response = await result.json();
      const messages: Record<string, string> = {
        ended:
          "This YouTube broadcast has ended. Stop YouTube before starting a new broadcast.",
        removed:
          "YouTube removed this broadcast. Check your channel in YouTube Studio.",
        "setup-required":
          "YouTube reports incomplete broadcast settings. Check your YouTube account.",
        "stream-error":
          "YouTube reports a video stream problem. Studio is checking again…",
        "waiting-video": "Waiting for YouTube to receive video…",
        reconnecting:
          "YouTube is live, but video reception is interrupted. Checking connection…",
        unknown: "Checking YouTube’s broadcast status…",
      };
      halted.current = ["ended", "removed", "setup-required"].includes(
        response.phase,
      );
      setError(messages[response.phase] ?? "");
    } catch {
      setError(
        halted.current
          ? "YouTube needs attention. Stop YouTube, check the account, then start again."
          : "YouTube status is temporarily unavailable. Retrying automatically…",
      );
      nextCheck.current =
        Date.now() +
        Math.min(60000, 5000 * 2 ** Math.min(++failures.current, 4));
    } finally {
      flight.current = false;
      setGoingLive(false);
    }
  }
  useEffect(() => {
    if (
      (autoGoLive || state?.streaming === "armed") &&
      state?.receiving &&
      !state.live &&
      !state.busy &&
      !halted.current &&
      Date.now() >= nextCheck.current
    )
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
    halted.current = action === "stop";
    nextCheck.current = 0;
    failures.current = 0;
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
          YouTube settings
        </a>
      </div>
      {state?.receiving && !state.live && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          {!error && (goingLive || autoGoLive || state.streaming === "armed")
            ? "Going live on YouTube…"
            : null}
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
