"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { organizerAccessToken } from "@/lib/access-session";
import type { SafeBroadcastSession } from "@/lib/broadcast-session";

const initial: SafeBroadcastSession = {
  desiredState: "stopped",
  status: "idle",
};

export function broadcastControlView(session: SafeBroadcastSession) {
  const live = session.status === "live";
  const idle = session.status === "idle";
  const stoppedForever = session.status === "stopped";
  const primaryAction: "start" | "stop" = idle
    ? "start"
    : live || session.desiredState === "stopped"
      ? "stop"
      : "start";
  const primaryLabel =
    session.status === "preparing"
      ? "Preparing YouTube…"
      : session.status === "stopping"
        ? "Stopping YouTube…"
        : live
          ? "Stop Broadcast"
          : idle
            ? "Start Broadcast"
            : stoppedForever
              ? "Broadcast stopped"
              : session.desiredState === "stopped"
                ? "Retry Stop"
                : "Start Broadcast";
  const statusMessage = live
    ? "Live on the saved team YouTube channel."
    : session.status === "failed"
      ? session.lastErrorCode === "youtube_live_streaming_not_enabled"
        ? "YouTube Live is not enabled for the saved channel. Enable it in YouTube, then retry."
        : "Broadcast failed. Retry the requested operation to reconcile it."
      : session.status === "preparing"
        ? "Preparing the YouTube stream…"
        : session.status === "stopping"
          ? "Provider shutdown is being confirmed…"
          : session.status === "stopped"
            ? "Provider output is stopped. This broadcast is final."
            : "YouTube is idle.";
  return {
    live,
    stoppedForever,
    primaryAction,
    primaryLabel,
    statusMessage,
    showStopPreparation: session.status === "preparing",
  };
}

export function BroadcastControl({
  gameId,
  enabled,
}: {
  gameId: string;
  enabled: boolean;
}) {
  const [session, setSession] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const flight = useRef(false);

  const request = useCallback(
    async (action?: "start" | "stop") => {
      if (flight.current) return;
      flight.current = true;
      if (action) setBusy(true);
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
      } catch (cause) {
        setError(
          cause instanceof Error ? cause.message : "Broadcast control failed.",
        );
      } finally {
        flight.current = false;
        setBusy(false);
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

  const view = broadcastControlView(session);
  const live = view.live;
  const transitional = ["preparing", "stopping"].includes(session.status);
  const stoppedForever = view.stoppedForever;
  const primaryAction = view.primaryAction;
  return (
    <div className="min-w-48 flex-1">
      <button
        className={
          live ? "btn min-h-11 w-full" : "btn-secondary min-h-11 w-full"
        }
        disabled={!enabled || busy || transitional || stoppedForever}
        onClick={() => {
          if (live) {
            if (confirm("Stop this YouTube broadcast? It cannot be restarted."))
              void request("stop");
          } else void request(primaryAction);
        }}
      >
        {busy ? (live ? "Stopping…" : "Preparing…") : view.primaryLabel}
      </button>
      <p className="mt-2 text-sm" role="status">
        {view.statusMessage}
      </p>
      {session.watchUrl && (
        <a
          className="mt-2 inline-block break-all text-cyan-300 underline"
          href={session.watchUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open YouTube broadcast
        </a>
      )}
      {error && (
        <p className="mt-2 text-sm text-red-300" role="alert">
          {error}
        </p>
      )}
      {session.status === "failed" && !stoppedForever && (
        <div className="mt-2 flex gap-2">
          <button
            className="btn-secondary min-h-11"
            disabled={busy}
            onClick={() =>
              void request(session.desiredState === "live" ? "start" : "stop")
            }
          >
            Retry
          </button>
          {session.desiredState === "live" && (
            <button
              className="btn-secondary min-h-11"
              disabled={busy}
              onClick={() => void request("stop")}
            >
              Stop instead
            </button>
          )}
        </div>
      )}
      {view.showStopPreparation && (
        <button
          className="btn-secondary mt-2 min-h-11"
          disabled={busy}
          onClick={() => void request("stop")}
        >
          Stop preparation
        </button>
      )}
    </div>
  );
}
