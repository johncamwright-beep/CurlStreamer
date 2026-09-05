"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { organizerAccessToken } from "@/lib/access-session";
import type { SafeBroadcastSession } from "@/lib/broadcast-session";

const initial: SafeBroadcastSession = {
  desiredState: "stopped",
  status: "idle",
};

const liveEligibilityErrors = new Set([
  "youtube_live_streaming_not_enabled",
  "youtube_live_permission_blocked",
]);
const accessErrors = new Set([
  "youtube_reconnect_required",
  "youtube_scope_missing",
]);
const terminalProviderErrors = new Set([
  "broadcast_provider_ended",
  "youtube_broadcast_terminal",
]);

function failureMessage(code?: string) {
  if (code === "youtube_live_streaming_not_enabled")
    return "Turn on YouTube Live for the connected channel. First-time activation can take up to 24 hours.";
  if (code === "youtube_live_permission_blocked")
    return "YouTube is currently blocking live streaming for this channel. Review its feature eligibility in YouTube.";
  if (accessErrors.has(code ?? ""))
    return "The saved YouTube connection no longer has the required access. Reconnect it in YouTube settings.";
  if (code === "youtube_quota_exceeded")
    return "YouTube API capacity is temporarily exhausted. Wait a little, then retry.";
  if (code === "youtube_provider_rejected")
    return "YouTube rejected the request. Review the connected channel in YouTube Studio, then retry.";
  if (code === "broadcast_provider_ended")
    return "YouTube reports that this broadcast is no longer live. Finish the broadcast to save its final state.";
  if (code === "youtube_broadcast_terminal")
    return "This YouTube broadcast has already ended. Finish the broadcast to save its final state.";
  if (
    code === "broadcast_operation_uncertain" ||
    code === "broadcast_discovery_incomplete"
  )
    return "The last attempt did not finish cleanly. Retry to continue safely without creating a duplicate broadcast.";
  return "The broadcast service is temporarily unavailable. Check your connection, then retry.";
}

export function broadcastControlView(
  session: SafeBroadcastSession,
  statusUnavailable = false,
  unconfirmedAction = false,
) {
  const lastConfirmedLive = session.status === "live";
  const live = lastConfirmedLive && !statusUnavailable;
  const stoppedForever = session.status === "stopped";
  const providerEnded = terminalProviderErrors.has(session.lastErrorCode ?? "");
  const primaryAction: "start" | "stop" | "refresh" = statusUnavailable
    ? "refresh"
    : session.status === "idle"
      ? "start"
      : live ||
          session.status === "preparing" ||
          session.desiredState === "stopped" ||
          providerEnded
        ? "stop"
        : "start";
  const primaryLabel = statusUnavailable
    ? "Retry status"
    : session.status === "preparing"
      ? "Cancel broadcast setup"
      : session.status === "stopping"
        ? "Ending broadcast…"
        : live
          ? "End broadcast"
          : session.status === "idle"
            ? "Start broadcast"
            : stoppedForever
              ? "Broadcast ended"
              : providerEnded
                ? "Finish broadcast"
                : primaryAction === "stop"
                  ? "Retry stop"
                  : "Retry broadcast";
  const statusLabel = statusUnavailable
    ? "Status unavailable"
    : session.status === "preparing"
      ? "Starting"
      : session.status === "stopping"
        ? "Ending"
        : live
          ? "Live"
          : stoppedForever
            ? "Ended"
            : session.status === "failed"
              ? "Needs attention"
              : "Not started";
  const statusMessage = statusUnavailable
    ? lastConfirmedLive
      ? "Last confirmed live. CurlCast could not refresh YouTube status; check the watch page or retry status."
      : "CurlCast could not refresh YouTube status. Check your connection, then retry status."
    : live
      ? "Video is being sent to the connected team YouTube channel."
      : session.status === "failed"
        ? failureMessage(session.lastErrorCode)
        : session.status === "preparing"
          ? "Creating the YouTube broadcast and connecting the program output."
          : session.status === "stopping"
            ? "Ending the YouTube stream and confirming that output has stopped."
            : stoppedForever
              ? "This broadcast has ended and cannot be resumed."
              : "Ready to create one YouTube broadcast for this game.";
  const tone = statusUnavailable
    ? "attention"
    : live
      ? "live"
      : session.status === "failed"
        ? "attention"
        : session.status === "preparing" || session.status === "stopping"
          ? "working"
          : "neutral";
  return {
    live,
    stoppedForever,
    primaryAction,
    primaryLabel,
    statusLabel,
    statusMessage,
    tone,
    showEndAction:
      (statusUnavailable &&
        (lastConfirmedLive ||
          unconfirmedAction ||
          session.status === "preparing" ||
          session.status === "stopping")) ||
      (session.status === "failed" &&
        session.desiredState === "live" &&
        primaryAction === "start"),
    supportLink:
      session.status !== "failed"
        ? undefined
        : liveEligibilityErrors.has(session.lastErrorCode ?? "")
          ? ("eligibility" as const)
          : accessErrors.has(session.lastErrorCode ?? "")
            ? ("settings" as const)
            : undefined,
  };
}

function YouTubeIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-8 w-8"
      focusable="false"
    >
      <path
        fill="#FF0000"
        d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814Z"
      />
      <path fill="#FFF" d="M9.545 15.568 15.818 12 9.545 8.432v7.136Z" />
    </svg>
  );
}

export function BroadcastControl({
  gameId,
  enabled,
}: {
  gameId: string;
  enabled: boolean;
}) {
  const [session, setSession] = useState(initial);
  const [busyAction, setBusyAction] = useState<"start" | "stop" | "refresh">();
  const [error, setError] = useState("");
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [unconfirmedAction, setUnconfirmedAction] = useState(false);
  const flight = useRef(false);

  const request = useCallback(
    async (action?: "start" | "stop", showRefresh = false) => {
      if (flight.current) return;
      flight.current = true;
      if (action || showRefresh) setBusyAction(action ?? "refresh");
      setError("");
      try {
        const token = organizerAccessToken(localStorage, gameId);
        const response = await fetch(`/api/games/${gameId}/broadcast`, {
          method: action ? "POST" : "GET",
          headers: {
            ...(action ? { "content-type": "application/json" } : {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          ...(action ? { body: JSON.stringify({ action }) } : {}),
        });
        const value = await response.json().catch(() => null);
        if (!response.ok)
          throw new Error(value?.error ?? "Broadcast control failed.");
        setSession(value);
        setStatusUnavailable(false);
        setUnconfirmedAction(false);
      } catch (cause) {
        setStatusUnavailable(true);
        if (action) setUnconfirmedAction(true);
        setError(
          cause instanceof Error ? cause.message : "Broadcast control failed.",
        );
      } finally {
        flight.current = false;
        setBusyAction(undefined);
      }
    },
    [gameId],
  );

  useEffect(() => {
    if (enabled) void request();
  }, [enabled, request]);

  useEffect(() => {
    if (!enabled || !["preparing", "stopping", "live"].includes(session.status))
      return;
    const timer = window.setInterval(
      () =>
        void request(
          session.status === "live"
            ? undefined
            : session.desiredState === "live"
              ? "start"
              : "stop",
        ),
      session.status === "live" ? 15_000 : 5_000,
    );
    return () => window.clearInterval(timer);
  }, [enabled, request, session.desiredState, session.status]);

  const view = broadcastControlView(
    session,
    statusUnavailable,
    unconfirmedAction,
  );
  const working = session.status === "stopping" && !statusUnavailable;
  const buttonLabel = busyAction
    ? busyAction === "refresh"
      ? "Checking status…"
      : busyAction === "stop"
        ? "Ending broadcast…"
        : "Starting broadcast…"
    : view.primaryLabel;
  const statusClass = {
    live: "border-emerald-400/50 bg-emerald-400/10 text-emerald-200",
    attention: "border-amber-400/50 bg-amber-400/10 text-amber-100",
    working: "border-cyan-400/40 bg-cyan-400/10 text-cyan-100",
    neutral: "border-slate-600 bg-slate-800 text-slate-300",
  }[view.tone];

  function confirmStop() {
    const prompt =
      session.status === "preparing"
        ? "Cancel this YouTube broadcast setup? This ends the attempt, and this game cannot start another broadcast."
        : "End this YouTube broadcast? This permanently stops the stream and cannot be resumed.";
    return confirm(prompt);
  }

  function runPrimaryAction() {
    if (view.primaryAction === "refresh") {
      void request(undefined, true);
      return;
    }
    if (view.primaryAction === "stop") {
      if (!confirmStop()) return;
    }
    void request(view.primaryAction);
  }

  function endBroadcast() {
    if (confirmStop()) void request("stop");
  }

  const youtubeDestination = session.watchUrl ?? "https://www.youtube.com/";
  return (
    <section
      className="panel overflow-hidden border-slate-600 bg-slate-900"
      aria-labelledby="youtube-broadcast-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <a
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            href={youtubeDestination}
            target="_blank"
            rel="noreferrer"
            aria-label={
              session.watchUrl
                ? "Open this broadcast on YouTube"
                : "Open YouTube"
            }
          >
            <YouTubeIcon />
          </a>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
              Streaming destination
            </p>
            <h2 id="youtube-broadcast-heading" className="text-xl font-bold">
              YouTube broadcast
            </h2>
          </div>
        </div>
        <span
          className={`inline-flex min-h-8 items-center gap-2 rounded-full border px-3 py-1 text-sm font-bold ${statusClass}`}
          role="status"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 rounded-full ${view.live ? "bg-emerald-300" : "bg-current"}`}
            aria-hidden="true"
          />
          {view.statusLabel}
        </span>
      </div>

      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">
        {view.statusMessage}
      </p>
      {view.supportLink === "settings" && (
        <Link
          className="mt-2 inline-flex min-h-11 items-center font-semibold text-cyan-300 underline underline-offset-4"
          href="/settings/youtube"
        >
          Review YouTube connection settings
        </Link>
      )}
      {view.supportLink === "eligibility" && (
        <a
          className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-cyan-300 underline underline-offset-4"
          href="https://www.youtube.com/features"
          target="_blank"
          rel="noreferrer"
        >
          Review YouTube feature eligibility
          <span aria-hidden="true">↗</span>
        </a>
      )}
      {error && (
        <div
          className="mt-4 rounded-xl border border-red-400/50 bg-red-950/40 p-3 text-sm text-red-100"
          role="alert"
        >
          <p className="font-semibold">Could not confirm broadcast status.</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className={`min-h-11 rounded-xl px-5 py-3 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50 ${
            view.primaryAction === "stop"
              ? "border border-red-400/60 bg-red-950/70 text-red-100"
              : "bg-cyan-300 text-slate-950"
          }`}
          disabled={
            !enabled || Boolean(busyAction) || working || view.stoppedForever
          }
          onClick={runPrimaryAction}
        >
          {buttonLabel}
        </button>
        {view.showEndAction && (
          <button
            className="min-h-11 rounded-xl border border-red-400/60 bg-red-950/70 px-5 py-3 font-bold text-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!enabled || Boolean(busyAction)}
            onClick={endBroadcast}
          >
            End broadcast
          </button>
        )}
        {session.watchUrl && (
          <a
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-600 px-4 py-2 font-semibold text-slate-100 underline-offset-4 hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
            href={session.watchUrl}
            target="_blank"
            rel="noreferrer"
          >
            Watch on YouTube
            <span aria-hidden="true">↗</span>
          </a>
        )}
      </div>
    </section>
  );
}
