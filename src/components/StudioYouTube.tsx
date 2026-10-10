"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requestStudioPresentation } from "@/lib/studio-presentation-client";
import { WindowsStudioRequired } from "./WindowsStudioRequired";
import { organizerAccessToken } from "@/lib/access-session";

const stateSchema = z.object({
  gameId: z.string(),
  available: z.boolean(),
  busy: z.boolean(),
  streaming: z.string(),
  live: z.boolean(),
  lastLiveAgeMs: z.number().nonnegative().nullable().optional(),
  concurrentViewers: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  receiving: z.boolean(),
  message: z.string().max(300),
  canReconnect: z.boolean().optional().default(false),
  canRecover: z.boolean().optional().default(false),
  needsRecovery: z.boolean().optional().default(false),
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
  const flight = useRef<AbortController | undefined>(undefined);
  const nextCheck = useRef(0);
  const failures = useRef(0);
  const halted = useRef(false);
  const confirmedLive = useRef(false);
  const [terminal, setTerminal] = useState(false);
  const lastViewers = useRef<number | undefined>(undefined);
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
    const attempt = new AbortController();
    flight.current = attempt;
    const isCurrent = () =>
      currentGame.current === id && flight.current === attempt;
    nextCheck.current = Date.now() + 10000;
    setGoingLive(true);
    setError("");
    let failureMessage = "";
    try {
      const result = await fetch(`/api/games/${id}/studio-m4`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(organizerAccessToken(localStorage, id)
            ? {
                authorization: `Bearer ${organizerAccessToken(localStorage, id)}`,
              }
            : {}),
        },
        body: JSON.stringify({ action: "go-live" }),
        signal: AbortSignal.any([attempt.signal, AbortSignal.timeout(30000)]),
      });
      if (!isCurrent() || confirmedLive.current) return;
      if (!result.ok) {
        const failure = z
          .object({
            error: z.string().min(1).max(300),
            code: z.literal("youtube_start_failed"),
          })
          .safeParse(await result.json().catch(() => null));
        if (failure.success && result.status === 503)
          failureMessage = failure.data.error;
        // A session can still be settling after encoder startup. A 409 is
        // recoverable; authority/input failures require operator attention.
        if ([400, 401, 402, 403].includes(result.status)) halted.current = true;
        throw Error();
      }
      failures.current = 0;
      const response = await result.json();
      if (!isCurrent() || confirmedLive.current) return;
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
      setTerminal(["ended", "removed"].includes(response.phase));
      setError(messages[response.phase] ?? "");
    } catch {
      if (!isCurrent() || confirmedLive.current) return;
      setError(
        failureMessage ||
          (halted.current
            ? "YouTube needs attention. Check YouTube settings. Your game’s watch link is retained."
            : "YouTube status is temporarily unavailable. Retrying automatically…"),
      );
      nextCheck.current =
        Date.now() +
        Math.min(60000, 5000 * 2 ** Math.min(++failures.current, 4));
    } finally {
      if (isCurrent()) {
        flight.current = undefined;
        setGoingLive(false);
      }
    }
  }
  useEffect(() => {
    if (
      (autoGoLive || state?.streaming === "armed") &&
      state?.gameId === id &&
      state.streaming === "armed" &&
      (state.receiving || state.outputActive) &&
      state.available &&
      !state.live &&
      !state.busy &&
      !pending &&
      !halted.current &&
      !confirmedLive.current &&
      Date.now() >= nextCheck.current
    )
      void goLive();
  }, [autoGoLive, bridgeAvailable, pending, state]);
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
          headers: organizerAccessToken(localStorage, id)
            ? {
                authorization: `Bearer ${organizerAccessToken(localStorage, id)}`,
              }
            : {},
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
    halted.current = false;
    nextCheck.current = 0;
    failures.current = 0;
    setAutoGoLive(false);
    setGoingLive(false);
    setError("");
    setTerminal(false);
    confirmedLive.current = false;
    lastViewers.current = undefined;
    presentationFlight.current = undefined;
    presentationConfirmedUntil.current = 0;
    setPending(false);
    setPresentationError("");
    setState(undefined);
    const receive = (event: Event) => {
      const parsed = stateSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== id) return;
      last = Date.now();
      if (parsed.data.live) {
        if (parsed.data.concurrentViewers != null)
          lastViewers.current = parsed.data.concurrentViewers;
        confirmedLive.current = true;
        failures.current = 0;
        setError("");
      } else if (
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
      flight.current?.abort();
      flight.current = undefined;
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
      flight.current?.abort();
      flight.current = undefined;
      setGoingLive(false);
      setTerminal(false);
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
  const needsRecovery =
    state?.needsRecovery ||
    state?.streaming === "failed" ||
    state?.streaming === "stopped";
  const ending = ["preparing-end", "ended"].includes(
    state?.presentation?.mode ?? "",
  );
  const viewerCount = state?.concurrentViewers ?? lastViewers.current;
  const showViewers =
    state &&
    (state.live ||
      (state.streaming === "armed" &&
        state.outputActive &&
        viewerCount != null));
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
        <div className="flex min-w-0 items-center gap-2">
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
                  : state.lastLiveAgeMs != null &&
                      state.lastLiveAgeMs < 30000 &&
                      state.outputActive &&
                      state.streaming === "armed"
                    ? "LIVE last confirmed · Rechecking…"
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
          {showViewers && (
            <span
              className="min-w-0 truncate text-xs text-slate-300"
              aria-live="polite"
              title="YouTube live viewer count. Updates about once a minute."
            >
              {viewerCount == null
                ? "Viewers unavailable"
                : state.live && state.concurrentViewers != null
                  ? `${viewerCount.toLocaleString()} watching now`
                  : `${viewerCount.toLocaleString()} last reported`}
            </span>
          )}
        </div>
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
            Boolean(needsRecovery && !state.canRecover) ||
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
                  : needsRecovery
                    ? state?.canRecover
                      ? "Reconnect broadcast"
                      : "Restart Studio to reconnect"
                    : "Broadcast to YouTube"}
        </button>
        {state?.gameId === id &&
          state.streaming === "armed" &&
          (state.receiving || state.outputActive) &&
          !state.live &&
          !confirmedLive.current &&
          !terminal && (
            <button
              className="btn-secondary min-h-11"
              disabled={goingLive || state.busy || pending || ending}
              title="Start this YouTube broadcast now, including before its scheduled time."
              onClick={() => {
                halted.current = false;
                failures.current = 0;
                nextCheck.current = 0;
                setAutoGoLive(true);
                void goLive();
              }}
            >
              {goingLive ? "Going live…" : "Go live now"}
            </button>
          )}
        <a className="btn-secondary" href="/settings/youtube">
          YouTube settings
        </a>
      </div>
      {needsRecovery && (
        <p className="mt-2 text-sm">
          {state?.canRecover
            ? "Reconnect restarts the local cameras and checks your existing YouTube broadcast. Your game and saved watch link are kept."
            : "Close and reopen Studio, choosing No when asked to end the game. Update Studio to reconnect here without closing the app."}
        </p>
      )}
      {active && !state?.canReconnect && (
        <p className="mt-2 text-sm">
          Update Windows Studio to disconnect and reconnect on the same watch
          link.
        </p>
      )}
      {(state?.receiving || state?.outputActive) && !state.live && (
        <div className="mt-2 flex items-center gap-2 text-sm">
          {!error && (goingLive || autoGoLive || state.streaming === "armed")
            ? "Starting this broadcast now. Waiting for YouTube to confirm live…"
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
