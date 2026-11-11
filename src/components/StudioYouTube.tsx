"use client";
import { createPortal } from "react-dom";
import { StudioStatusMessage } from "./StudioStatusArea";
import { StudioOverlay } from "./StudioOverlay";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { requestStudioPresentation } from "@/lib/studio-presentation-client";
import { WindowsStudioRequired } from "./WindowsStudioRequired";
import { organizerAccessToken } from "@/lib/access-session";
import { studioLastLiveLabel, studioSessionBridge } from "@/lib/studio-session";

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
  canRestartBroadcast: z.boolean().optional().default(false),
  programAuthorityEnded: z.boolean().optional().default(false),
  presentation: z
    .object({
      mode: z.enum(["live", "hold", "preparing-end", "ended"]),
      generation: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
const watchUrlSchema = z
  .string()
  .regex(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/);
const broadcastSessionSchema = z.object({
  desiredState: z.enum(["live", "stopped"]).optional(),
  status: z
    .enum(["idle", "preparing", "prepared", "stopping", "stopped", "failed"])
    .optional(),
  watchUrl: watchUrlSchema.optional(),
  lastErrorCode: z.string().optional(),
});

function studioBroadcastRequest(
  gameId: string,
  signal: AbortSignal,
  action?: { action: "go-live" } | { action: "restart"; watchUrl: string },
) {
  const token = organizerAccessToken(localStorage, gameId);
  return fetch(`/api/games/${gameId}/studio-m4`, {
    cache: "no-store",
    headers: {
      ...(action ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(action ? { method: "POST", body: JSON.stringify(action) } : {}),
    signal,
  });
}

export function StudioYouTube({
  id,
  controlsTarget,
  presentationControlsTarget,
}: {
  id: string;
  controlsTarget?: string;
  presentationControlsTarget?: string;
}) {
  const [controlsHost, setControlsHost] = useState<HTMLElement | null>(null);
  const [presentationControlsHost, setPresentationControlsHost] =
    useState<HTMLElement | null>(null);
  useEffect(() => {
    setControlsHost(
      controlsTarget ? document.getElementById(controlsTarget) : null,
    );
    setPresentationControlsHost(
      presentationControlsTarget
        ? document.getElementById(presentationControlsTarget)
        : null,
    );
  }, [controlsTarget, presentationControlsTarget]);
  const [state, setState] = useState<z.infer<typeof stateSchema>>();
  const [pending, setPending] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [error, setError] = useState("");
  const [stopOpen, setStopOpen] = useState(false);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [presentationError, setPresentationError] = useState("");
  const [restartOpen, setRestartOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [watchUrl, setWatchUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [bridgeAvailable, setBridgeAvailable] = useState(false);
  const flight = useRef<AbortController | undefined>(undefined);
  const replacementFlight = useRef<AbortController | undefined>(undefined);
  const sessionRevision = useRef(0);
  const nextCheck = useRef(0);
  const failures = useRef(0);
  const halted = useRef(false);
  const confirmedLive = useRef<string | undefined>(undefined);
  const [endedWatchUrl, setEndedWatchUrl] = useState<string>();
  const lastViewers = useRef<number | undefined>(undefined);
  const presentationFlight = useRef<object | undefined>(undefined);
  const presentationConfirmedUntil = useRef(0);
  const currentGame = useRef(id);
  currentGame.current = id;
  const watchingOutput = state && ["armed", "paused"].includes(state.streaming);
  const held = state?.presentation?.mode === "hold";
  const disconnected = state?.streaming === "paused";
  const terminal =
    endedWatchUrl !== undefined &&
    (!endedWatchUrl || endedWatchUrl === watchUrl);
  const ending = ["preparing-end", "ended"].includes(
    state?.presentation?.mode ?? "",
  );
  const wasLive =
    (state?.gameId === id && state.live) || confirmedLive.current === id;
  const broadcastLive =
    wasLive &&
    !terminal &&
    !disconnected &&
    (!state || ["armed", "starting"].includes(state.streaming));
  const launching =
    state?.gameId === id &&
    ["starting", "armed"].includes(state.streaming) &&
    !state.live &&
    confirmedLive.current !== id &&
    !state.programAuthorityEnded &&
    !held &&
    !ending &&
    !replacing &&
    !terminal;
  const canGoLive =
    launching &&
    state.streaming === "armed" &&
    (state.receiving || state.outputActive);
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
    if (!bridgeAvailable || flight.current || confirmedLive.current === id)
      return;
    const attempt = new AbortController();
    flight.current = attempt;
    const isCurrent = () =>
      currentGame.current === id && flight.current === attempt;
    nextCheck.current = Date.now() + 10000;
    setGoingLive(true);
    setError("");
    let failureMessage = "";
    try {
      const result = await studioBroadcastRequest(
        id,
        AbortSignal.any([attempt.signal, AbortSignal.timeout(30000)]),
        { action: "go-live" },
      );
      if (!isCurrent() || confirmedLive.current === id) return;
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
      if (!isCurrent() || confirmedLive.current === id) return;
      const messages: Record<string, string> = {
        ended:
          "YouTube finished this broadcast. Restart broadcast to continue this game on a new watch link.",
        removed:
          "YouTube removed this broadcast. Restart broadcast to continue this game on a new watch link.",
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
      if (["live", "reconnecting"].includes(response.phase))
        confirmedLive.current = id;
      if (["ended", "removed"].includes(response.phase)) {
        const endedLink = watchUrlSchema.safeParse(response.watchUrl);
        if (endedLink.success) setWatchUrl(endedLink.data);
        setEndedWatchUrl(endedLink.success ? endedLink.data : watchUrl);
      }
      setError(messages[response.phase] ?? "");
    } catch {
      if (!isCurrent() || confirmedLive.current === id) return;
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
      canGoLive &&
      state.available &&
      !state.busy &&
      !pending &&
      !halted.current &&
      Date.now() >= nextCheck.current
    )
      void goLive();
  }, [bridgeAvailable, canGoLive, pending, state]);
  async function replaceBroadcast() {
    if (replacementFlight.current || !canReplaceBroadcast) return;
    const attempt = new AbortController();
    replacementFlight.current = attempt;
    sessionRevision.current++;
    const isCurrent = () =>
      currentGame.current === id && replacementFlight.current === attempt;
    setReplacementOpen(false);
    setReplacing(true);
    setError("");
    try {
      const response = await studioBroadcastRequest(
        id,
        AbortSignal.any([attempt.signal, AbortSignal.timeout(90000)]),
        { action: "restart", watchUrl },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!isCurrent()) return;
      if (!response.ok) {
        const problem = z
          .object({ error: z.string().max(300) })
          .safeParse(payload);
        throw new Error(
          problem.success
            ? problem.data.error
            : "YouTube could not restart the broadcast. Try again.",
        );
      }
      const result = broadcastSessionSchema.safeParse(payload);
      if (
        !result.success ||
        result.data.desiredState !== "live" ||
        result.data.watchUrl === watchUrl
      )
        throw new Error(
          "YouTube could not prepare a new broadcast. Try again shortly.",
        );
      setWatchUrl(result.data.watchUrl ?? "");
      setEndedWatchUrl(undefined);
      confirmedLive.current = undefined;
      lastViewers.current = undefined;
      if (result.data.status !== "prepared" || !result.data.watchUrl)
        throw new Error(
          "The new broadcast is not ready. Try connecting again shortly.",
        );
      await send(state?.canRestartBroadcast ? "restart" : "start");
    } catch (cause) {
      if (isCurrent())
        setError(
          cause instanceof Error
            ? cause.message
            : "YouTube could not restart the broadcast. Try again.",
        );
    } finally {
      if (isCurrent()) {
        replacementFlight.current = undefined;
        setReplacing(false);
      }
    }
  }
  useEffect(() => {
    setWatchUrl("");
    setCopied(false);
    setCopyError("");
    if (!bridgeAvailable) return;
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading || replacementFlight.current) return;
      loading = true;
      const revision = sessionRevision.current;
      try {
        const response = await studioBroadcastRequest(id, controller.signal);
        if (!response.ok) return;
        const result = broadcastSessionSchema.parse(await response.json());
        if (controller.signal.aborted || revision !== sessionRevision.current)
          return;
        setWatchUrl(result.watchUrl ?? "");
        if (
          result.watchUrl &&
          (result.lastErrorCode === "youtube_broadcast_terminal" ||
            (result.desiredState === "stopped" &&
              ["stopped", "failed"].includes(result.status ?? "")))
        )
          setEndedWatchUrl(result.watchUrl);
      } catch {
        /* Retry during this output session; never display an unverified destination. */
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(load, 30000);
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
    setGoingLive(false);
    setError("");
    setStopOpen(false);
    setReplacementOpen(false);
    setReplacing(false);
    setEndedWatchUrl(undefined);
    confirmedLive.current = undefined;
    lastViewers.current = undefined;
    presentationFlight.current = undefined;
    presentationConfirmedUntil.current = 0;
    setPending(false);
    setRestartOpen(false);
    setRestarting(false);
    setPresentationError("");
    setState(undefined);
    const receive = (event: Event) => {
      const parsed = stateSchema.safeParse((event as CustomEvent).detail);
      if (!parsed.success || parsed.data.gameId !== id) return;
      last = Date.now();
      if (parsed.data.streaming === "paused") confirmedLive.current = undefined;
      if (
        parsed.data.live ||
        (parsed.data.streaming === "armed" &&
          parsed.data.outputActive &&
          parsed.data.lastLiveAgeMs != null)
      ) {
        if (parsed.data.concurrentViewers != null)
          lastViewers.current = parsed.data.concurrentViewers;
        confirmedLive.current = id;
        failures.current = 0;
        setError("");
      }
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
      replacementFlight.current?.abort();
      replacementFlight.current = undefined;
      clearInterval(timer);
      window.removeEventListener("studio-youtube-status", receive);
    };
  }, [id]);
  async function send(
    action: "start" | "disconnect" | "hold" | "resume" | "restart",
  ) {
    const bridge = studioSessionBridge();
    if (
      !bridge ||
      pending ||
      presentationFlight.current ||
      !state ||
      state.busy ||
      (action === "restart" && !state.canRestartBroadcast) ||
      (action === "disconnect" &&
        (!state.canReconnect || state.streaming !== "armed")) ||
      (["hold", "resume"].includes(action) && !state.canHoldStream)
    )
      return;
    if (action === "start" || action === "disconnect" || action === "restart") {
      flight.current?.abort();
      flight.current = undefined;
      setGoingLive(false);
      halted.current = action === "disconnect";
      nextCheck.current = 0;
      failures.current = 0;
    }
    setError("");
    setPresentationError("");
    setPending(true);
    if (action === "hold" || action === "resume" || action === "restart") {
      const attempt = {};
      presentationFlight.current = attempt;
      setRestarting(action === "restart");
      try {
        const receipt = await requestStudioPresentation(id, action);
        if (
          currentGame.current !== id ||
          presentationFlight.current !== attempt
        )
          return;
        if (action === "restart") return;
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
          setRestarting(false);
          setPending(false);
        }
      }
      return;
    }
    bridge.postMessage({
      type:
        action === "disconnect"
          ? "studio-youtube-stop"
          : "studio-youtube-start",
      gameId: id,
    });
  }
  const active =
    state && ["starting", "armed", "stopping"].includes(state.streaming);
  const needsRecovery =
    state?.needsRecovery ||
    state?.streaming === "failed" ||
    state?.streaming === "stopped";
  const restartRequired = Boolean(
    state?.programAuthorityEnded && state.canRestartBroadcast,
  );
  const offerRestart =
    state?.canRestartBroadcast &&
    !ending &&
    !terminal &&
    !disconnected &&
    !replacing &&
    (restartRequired ||
      held ||
      Boolean(presentationError) ||
      (wasLive && needsRecovery));
  const blocked = !state?.available || state.busy || pending || ending;
  const canStopBroadcast =
    broadcastLive &&
    !blocked &&
    !replacing &&
    state?.streaming === "armed" &&
    state.canReconnect;
  const canReplaceBroadcast =
    terminal &&
    Boolean(watchUrl) &&
    !blocked &&
    !replacing &&
    (state?.streaming === "idle" || state?.canRestartBroadcast === true);
  const starting = launching && (!canGoLive || goingLive);
  const reconnectingOutput =
    needsRecovery && state?.canRecover && !offerRestart;
  const showPictureControl =
    restarting ||
    (!replacing &&
      !disconnected &&
      !restartRequired &&
      !ending &&
      !terminal &&
      (held ||
        (broadcastLive &&
          (state?.streaming === "armed" || reconnectingOutput))));
  let broadcastLabel = "Broadcast to YouTube";
  if (replacing) broadcastLabel = "Restarting broadcast…";
  else if (broadcastLive) broadcastLabel = "Stop broadcast";
  else if (pending || state?.busy) broadcastLabel = "Please wait…";
  else if (terminal || disconnected) broadcastLabel = "Restart broadcast";
  else if (starting) broadcastLabel = "Starting broadcast…";
  else if (needsRecovery)
    broadcastLabel = state?.canRecover
      ? "Reconnect broadcast"
      : "Restart Studio to reconnect";
  const viewerCount = state?.concurrentViewers ?? lastViewers.current;
  const showViewers =
    state &&
    (state.live ||
      (state.streaming === "armed" &&
        state.outputActive &&
        viewerCount != null));
  const lastLiveLabel =
    state?.streaming === "armed" &&
    state.outputActive &&
    state.lastLiveAgeMs != null
      ? studioLastLiveLabel(state.lastLiveAgeMs)
      : undefined;
  const broadcastControls = (
    <button
      type="button"
      className="btn min-h-11"
      title={
        launching
          ? "Start this YouTube broadcast now, including before its scheduled time."
          : undefined
      }
      disabled={
        terminal
          ? !canReplaceBroadcast
          : broadcastLive
            ? !canStopBroadcast
            : replacing ||
              blocked ||
              starting ||
              (restartRequired && !disconnected) ||
              state?.streaming === "stopping" ||
              Boolean(needsRecovery && !state?.canRecover)
      }
      onClick={() => {
        if (canReplaceBroadcast) {
          setReplacementOpen(true);
        } else if (canStopBroadcast) {
          setStopOpen(true);
        } else if (canGoLive) {
          halted.current = false;
          failures.current = 0;
          nextCheck.current = 0;
          void goLive();
        } else {
          void send(
            disconnected &&
              (restartRequired || presentationError) &&
              state?.canRestartBroadcast
              ? "restart"
              : "start",
          );
        }
      }}
    >
      {broadcastLabel}
    </button>
  );
  const presentationControls = (showPictureControl || offerRestart) && (
    <div className="flex flex-wrap gap-2">
      {showPictureControl && (
        <button
          type="button"
          className="btn-secondary min-h-11"
          disabled={
            blocked ||
            restarting ||
            (!reconnectingOutput &&
              (held
                ? !state?.canHoldStream
                : !state?.canHoldStream && !state?.canReconnect))
          }
          title={
            reconnectingOutput
              ? "Reconnect local video to the same YouTube broadcast."
              : held
                ? "Return from the temporary pause card to live video on the same watch link."
                : state?.canHoldStream
                  ? "Show a temporary pause card while keeping the stream connected."
                  : "Disconnect video temporarily. Update Windows Studio to show a pause card while keeping the stream connected."
          }
          onClick={() =>
            void send(
              reconnectingOutput
                ? "start"
                : held
                  ? "resume"
                  : state?.canHoldStream
                    ? "hold"
                    : "disconnect",
            )
          }
        >
          {restarting
            ? "Restarting connection…"
            : pending || state?.busy
              ? "Please wait…"
              : reconnectingOutput
                ? "Reconnect broadcast"
                : held
                  ? "Resume broadcast"
                  : state?.canHoldStream
                    ? "Pause broadcast"
                    : "Disconnect"}
        </button>
      )}
      {offerRestart && !restarting && (
        <button
          type="button"
          className={
            restartRequired ? "btn min-h-11" : "btn-secondary min-h-11"
          }
          disabled={pending || state.busy}
          onClick={() => setRestartOpen(true)}
        >
          Restart broadcast connection
        </button>
      )}
    </div>
  );
  if (!bridgeAvailable) return <WindowsStudioRequired gameId={id} />;
  return (
    <section
      className={`scoring-card studio-youtube${controlsTarget ? " studio-youtube-quick" : ""}`}
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
            className={
              state?.live && !terminal && !disconnected
                ? "text-red-400"
                : "text-slate-300"
            }
            title={
              !terminal && !state?.live && lastLiveLabel
                ? `${lastLiveLabel}. Studio is still sending video; a fresh YouTube confirmation is unavailable.`
                : undefined
            }
          >
            {terminal
              ? "Broadcast ended"
              : !state
                ? "Status unavailable"
                : disconnected
                  ? "Disconnected"
                  : held
                    ? state.live
                      ? "Paused · YouTube still live"
                      : "Paused · Sending card"
                    : state.live
                      ? "● LIVE"
                      : watchingOutput && state.outputActive
                        ? "Sending video"
                        : state?.receiving
                          ? "Receiving video"
                          : watchingOutput
                            ? "Checking status…"
                            : active
                              ? "Connecting…"
                              : "Not live"}
          </strong>
          {showViewers && !terminal && !disconnected && (
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
      {controlsHost
        ? createPortal(broadcastControls, controlsHost)
        : broadcastControls}
      {presentationControlsHost
        ? createPortal(presentationControls, presentationControlsHost)
        : presentationControls}
      <StudioOverlay
        title="Stop broadcast?"
        open={stopOpen}
        onClose={() => setStopOpen(false)}
      >
        <p>
          Studio will stop sending video. Restart broadcast to reconnect on the
          same YouTube link.
        </p>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!canStopBroadcast}
          onClick={() => {
            setStopOpen(false);
            void send("disconnect");
          }}
        >
          Stop broadcast
        </button>
      </StudioOverlay>
      <StudioOverlay
        title="Restart broadcast?"
        open={replacementOpen}
        onClose={() => setReplacementOpen(false)}
      >
        <p>
          The previous broadcast ended. Studio will create a new YouTube link
          for this game.
        </p>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!canReplaceBroadcast}
          onClick={() => void replaceBroadcast()}
        >
          Restart broadcast
        </button>
      </StudioOverlay>
      <StudioOverlay
        title="Restart broadcast connection"
        open={restartOpen}
        onClose={() => setRestartOpen(false)}
      >
        <p>
          Studio will disconnect and reconnect to the saved YouTube broadcast.
          Waiting for the previous connection can take about 90 seconds. Your
          game and scores stay open.
        </p>
        <button
          type="button"
          className="btn min-h-11"
          disabled={!offerRestart || pending || state?.busy}
          onClick={() => {
            setRestartOpen(false);
            void send("restart");
          }}
        >
          Restart connection
        </button>
      </StudioOverlay>
      <StudioStatusMessage
        message={
          !terminal && restartRequired
            ? "The Studio video session expired. Restart the broadcast connection to return to game video."
            : presentationError && !state?.canRestartBroadcast
              ? "If Resume keeps failing, press Ctrl+Shift+Q to close Studio. Reopen the same game and reconnect to its saved broadcast."
              : null
        }
      />
      <a className="btn-secondary" href="/settings/youtube">
        YouTube settings
      </a>
      <StudioStatusMessage
        message={
          !terminal && needsRecovery
            ? state?.canRecover
              ? "Reconnect restarts the local cameras and checks your existing YouTube broadcast. Your game and watch link are kept."
              : "YouTube: Close and reopen Studio, choosing No when asked to end the game. Update Studio to reconnect here."
            : null
        }
      />
      <StudioStatusMessage
        message={
          active && !state?.canReconnect
            ? "Update Windows Studio to reconnect on the same watch link."
            : null
        }
      />
      <StudioStatusMessage
        message={
          !terminal &&
          !disconnected &&
          (state?.receiving || state?.outputActive) &&
          !state.live &&
          !error
            ? lastLiveLabel
              ? `${lastLiveLabel}. YouTube’s status update is delayed.`
              : confirmedLive.current === id
                ? state.outputActive
                  ? "Studio is still sending video. Waiting for a fresh YouTube status."
                  : "Waiting for a fresh YouTube status."
                : launching
                  ? "Starting this broadcast now. Waiting for YouTube to confirm live…"
                  : null
            : null
        }
      />
      <StudioStatusMessage
        role="alert"
        source="YouTube"
        message={error && (terminal || !state?.live) ? error : null}
      />
      <StudioStatusMessage
        role="alert"
        source="YouTube"
        message={presentationError || null}
      />
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
      <StudioStatusMessage
        role="alert"
        source="YouTube"
        message={copyError || null}
      />
      <StudioStatusMessage
        message={
          !state?.available || state?.message
            ? state?.message || "Preparing Studio’s YouTube connection…"
            : null
        }
      />
    </section>
  );
}
