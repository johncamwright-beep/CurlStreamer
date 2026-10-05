"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requestStudioPresentation } from "@/lib/studio-presentation-client";
import { WindowsStudioRequired } from "./WindowsStudioRequired";

const stateSchema = z.object({
  gameId: z.string(),
  available: z.boolean(),
  busy: z.boolean(),
  streaming: z.string(),
  live: z.boolean(),
  receiving: z.boolean(),
  message: z.string().max(300),
  canReconnect: z.boolean().optional().default(false),
  outputActive: z.boolean().optional().default(false),
  canHoldStream: z.boolean().optional().default(false),
  presentation: z
    .object({
      mode: z.enum(["live", "hold", "preparing-end", "ended"]),
      generation: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export function StudioYouTube({ id }: { id: string }) {
  const [state, setState] = useState<z.infer<typeof stateSchema>>();
  const [pending, setPending] = useState(false);
  const [autoGoLive, setAutoGoLive] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [error, setError] = useState("");
  const [presentationError, setPresentationError] = useState("");
  const [watchUrl, setWatchUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const flight = useRef(false);
  const nextCheck = useRef(0);
  const failures = useRef(0);
  const halted = useRef(false);
  const confirmedLive = useRef(false);
  const presentationFlight = useRef<object | undefined>(undefined);
  const presentationConfirmedUntil = useRef(0);
  const currentGame = useRef(id);
  currentGame.current = id;
  const watchingOutput = state && ["armed", "paused"].includes(state.streaming);
  useEffect(() => {
    setBridgeAvailable(
      Boolean(
        (
          window as unknown as {
            chrome?: { webview?: { postMessage(value: unknown): void } };
          }
        ).chrome?.webview,
      ),
    );
  }, []);
  async function goLive() {
    if (!bridgeAvailable || flight.current) return;
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
          "YouTube has completed this broadcast and cannot reopen its watch link. Start a new game for a new broadcast.",
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
          ? "YouTube needs attention. Check YouTube settings. Your game’s watch link is retained."
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
      !confirmedLive.current &&
      Date.now() >= nextCheck.current
    )
      void goLive();
  }, [autoGoLive, bridgeAvailable, state]);
  useEffect(() => {
    setWatchUrl("");
    setCopied(false);
    setCopyError("");
    if (!bridgeAvailable) return;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
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
        /* Retry during this output session; never display an unverified destination. */
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [id, bridgeAvailable]);
  useEffect(() => {
    let last = 0;
    confirmedLive.current = false;
    presentationFlight.current = undefined;
    presentationConfirmedUntil.current = 0;
    setPending(false);
    setPresentationError("");
    setState(undefined);
    const receive = (event: Event) => {
      const parsed = stateSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== id) return;
      last = Date.now();
      if (parsed.data.live) confirmedLive.current = true;
      else if (
        ["idle", "starting", "stopping", "stopped", "failed"].includes(
          parsed.data.streaming,
        )
      )
        confirmedLive.current = false;
      setState((current) =>
        Date.now() < presentationConfirmedUntil.current &&
        current?.streaming === "armed" &&
        parsed.data.streaming === "armed" &&
        current.presentation?.generation !== undefined &&
        parsed.data.presentation?.generation !== undefined &&
        current.presentation.generation > parsed.data.presentation.generation
          ? { ...parsed.data, presentation: current.presentation }
          : parsed.data,
      );
      if (!presentationFlight.current) setPending(false);
    };
    window.addEventListener("studio-youtube-status", receive);
    const timer = setInterval(() => {
      if (Date.now() - last > 6000) {
        setState(undefined);
        if (!presentationFlight.current) setPending(false);
      }
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("studio-youtube-status", receive);
    };
  }, [id]);
  async function send(action: "start" | "stop" | "hold" | "resume") {
    const bridge = (
      window as unknown as {
        chrome?: { webview?: { postMessage(value: unknown): void } };
      }
    ).chrome?.webview;
    if (
      !bridge ||
      pending ||
      presentationFlight.current ||
      !state ||
      state.busy ||
      (action === "stop" && !state.canReconnect) ||
      (["hold", "resume"].includes(action) && !state.canHoldStream)
    )
      return;
    if (action === "start" || action === "stop") {
      setAutoGoLive(action === "start");
      halted.current = action === "stop";
      nextCheck.current = 0;
      failures.current = 0;
      confirmedLive.current = false;
    }
    setError("");
    setPresentationError("");
    setPending(true);
    if (action === "hold" || action === "resume") {
      const attempt = {};
      presentationFlight.current = attempt;
      try {
        const receipt = await requestStudioPresentation(id, action);
        if (
          currentGame.current !== id ||
          presentationFlight.current !== attempt
        )
          return;
        const presentation = receipt.presentation;
        if (!presentation)
          throw new Error("Studio did not confirm the broadcast picture.");
        presentationConfirmedUntil.current = Date.now() + 2000;
        setState((current) => {
          if (
            !current ||
            current.gameId !== id ||
            (current.presentation?.generation !== undefined &&
              current.presentation.generation > presentation.generation)
          )
            return current;
          return { ...current, presentation };
        });
      } catch (cause) {
        if (
          currentGame.current === id &&
          presentationFlight.current === attempt
        )
          setPresentationError(
            cause instanceof Error
              ? cause.message
              : "Studio could not confirm the broadcast picture.",
          );
      } finally {
        if (
          currentGame.current === id &&
          presentationFlight.current === attempt
        ) {
          presentationFlight.current = undefined;
          setPending(false);
        }
      }
      return;
    }
    bridge.postMessage({ type: `studio-youtube-${action}`, gameId: id });
  }
  const active =
    state && ["starting", "armed", "stopping"].includes(state.streaming);
  const held = state?.presentation?.mode === "hold";
  const ending = ["preparing-end", "ended"].includes(
    state?.presentation?.mode ?? "",
  );
  if (!bridgeAvailable) return <WindowsStudioRequired gameId={id} />;
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
          {!state
            ? "Status unavailable"
            : held
              ? state.live
                ? "● LIVE · Paused"
                : "Paused · Sending card"
              : state.live
                ? "● LIVE"
                : state.streaming === "paused"
                  ? "Disconnected"
                  : state?.receiving
                    ? "Receiving video"
                    : watchingOutput
                      ? state.outputActive
                        ? "Sending video · Checking YouTube…"
                        : "Checking status…"
                      : active
                        ? "Connecting…"
                        : "Not live"}
        </strong>
      </div>
      <div className="studio-youtube-actions flex flex-wrap gap-2">
        <button
          className="btn"
          title={
            held
              ? "Return from the temporary pause card to live video on the same watch link."
              : active && state?.canHoldStream
                ? "Show a temporary pause card while keeping the stream connected."
                : active && state?.canReconnect
                  ? "Disconnect video temporarily. Update Windows Studio to show a pause card while keeping the stream connected."
                  : undefined
          }
          disabled={
            !state?.available ||
            state.busy ||
            pending ||
            ending ||
            Boolean(active && !state.canHoldStream && !state.canReconnect)
          }
          onClick={() =>
            send(
              held
                ? "resume"
                : active
                  ? state?.canHoldStream
                    ? "hold"
                    : "stop"
                  : "start",
            )
          }
        >
          {pending || state?.busy
            ? "Please wait…"
            : held
              ? "Resume broadcast"
              : active
                ? state?.canHoldStream
                  ? "Pause broadcast"
                  : "Disconnect"
                : state?.streaming === "paused"
                  ? "Reconnect"
                  : "Broadcast to YouTube"}
        </button>
        <a className="btn-secondary" href="/settings/youtube">
          YouTube settings
        </a>
      </div>
      {active && !state?.canReconnect && (
        <p className="mt-2 text-sm">
          Update Windows Studio to disconnect and reconnect on the same watch
          link.
        </p>
      )}
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
      {presentationError && (
        <p role="alert" className="mt-2 text-sm text-amber-200">
          {presentationError}
        </p>
      )}
      {watchUrl && (
        <div className="studio-youtube-watch mt-2 flex items-center gap-2 text-sm">
          <a
            className="min-w-0 flex-1 truncate underline"
            title={watchUrl}
            href={watchUrl}
            target="_blank"
            rel="noreferrer"
          >
            Watch on YouTube
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
      {copyError && <p role="alert">{copyError}</p>}
      {(!state?.available || state?.message) && (
        <p className="mt-2 text-sm text-slate-300">
          {state?.message || "Preparing Studio’s YouTube connection…"}
        </p>
      )}
    </section>
  );
}
