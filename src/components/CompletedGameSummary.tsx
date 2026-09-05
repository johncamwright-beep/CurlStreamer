"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type {
  CompletionCleanup,
  SafeGameCompletion,
} from "@/lib/game-completion";
import { organizerAccessToken } from "@/lib/access-session";

function completionToken(gameId: string) {
  return (
    organizerAccessToken(localStorage, gameId) ??
    localStorage.getItem(`curlcast-access-${gameId}`)
  );
}

function resultLabel(completion: SafeGameCompletion) {
  const totals = completion.result.totals;
  return totals
    ? `${completion.homeName} ${totals.home} – ${totals.away} ${completion.awayName}`
    : completion.result.label;
}

export function CompletedGameSummary({
  gameId,
  completion,
  cleanupControls = false,
  initialCleanup,
}: {
  gameId: string;
  completion: SafeGameCompletion;
  cleanupControls?: boolean;
  initialCleanup?: CompletionCleanup;
}) {
  const [cleanup, setCleanup] = useState<CompletionCleanup | undefined>(
    initialCleanup,
  );
  const [cleanupError, setCleanupError] = useState("");
  const [busy, setBusy] = useState(false);
  const cleanupStatus = cleanup?.status;
  const loadCleanup = useCallback(async () => {
    try {
      const token = completionToken(gameId);
      const response = await fetch(`/api/games/${gameId}/completion`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cache: "no-store",
      });
      const value = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(value?.error ?? "Shutdown status is unavailable.");
      setCleanup(value);
      setCleanupError("");
    } catch (cause) {
      setCleanupError(
        cause instanceof Error
          ? cause.message
          : "Shutdown status is unavailable.",
      );
    }
  }, [gameId]);
  useEffect(() => {
    if (cleanupControls && !initialCleanup) void loadCleanup();
  }, [cleanupControls, initialCleanup, loadCleanup]);

  const retryCleanup = useCallback(async () => {
    try {
      const token = completionToken(gameId);
      const response = await fetch(`/api/games/${gameId}/completion`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ action: "retry-cleanup" }),
      });
      const value = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(value?.error ?? "Live video shutdown retry failed.");
      setCleanup(value);
      setCleanupError("");
      return value as CompletionCleanup;
    } catch (cause) {
      setCleanupError(
        cause instanceof Error
          ? cause.message
          : "Live video shutdown retry failed.",
      );
    }
  }, [gameId]);

  useEffect(() => {
    if (!cleanupControls || !cleanupStatus || cleanupStatus === "complete")
      return;
    let cancelled = false;
    void (async () => {
      for (let attempt = 1; attempt <= 3 && !cancelled; attempt += 1) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, attempt * 2_000),
        );
        if (cancelled) return;
        const next = await retryCleanup();
        if (next?.status === "complete") return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cleanupControls, cleanupStatus, retryCleanup]);

  async function retry() {
    setBusy(true);
    await retryCleanup();
    setBusy(false);
  }

  return (
    <section className="panel text-center" aria-labelledby="final-result">
      <p className="text-sm font-bold uppercase tracking-widest text-cyan-300">
        Final result
      </p>
      <h1 id="final-result" className="mt-2 text-3xl font-black">
        {resultLabel(completion)}
      </h1>
      <p className="mt-2 text-slate-300">{completion.eventName}</p>
      <p className="mt-2 text-slate-400">
        Completed{" "}
        <time dateTime={completion.completedAt}>
          {new Date(completion.completedAt).toLocaleString("en-CA", {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: "UTC",
          })}{" "}
          UTC
        </time>
      </p>
      {completion.youtubeWatchUrl && (
        <a
          className="btn-secondary mt-4 inline-flex"
          href={completion.youtubeWatchUrl}
          target="_blank"
          rel="noreferrer"
        >
          Watch on YouTube
        </a>
      )}
      {cleanup && cleanup.status !== "complete" && (
        <div
          role="status"
          className="mt-4 rounded-lg bg-amber-950 p-3 text-amber-200"
        >
          <p>Live video shutdown has not been confirmed.</p>
          {cleanup.lastError && (
            <p className="mt-2 text-sm">Last attempt: {cleanup.lastError}</p>
          )}
          <button
            className="btn-secondary mt-3"
            disabled={busy}
            onClick={retry}
          >
            {busy ? "Retrying…" : "Retry live video shutdown"}
          </button>
        </div>
      )}
      {cleanupControls && cleanupError && (
        <div
          role="alert"
          className="mt-4 rounded-lg bg-amber-950 p-3 text-amber-200"
        >
          <p>{cleanupError} The final result remains saved.</p>
          {!cleanup && (
            <button
              className="btn-secondary mt-3"
              disabled={busy}
              onClick={retry}
            >
              {busy ? "Retrying…" : "Retry live video shutdown"}
            </button>
          )}
        </div>
      )}
      {cleanup?.status === "complete" && (
        <p role="status" className="mt-4 text-emerald-300">
          LiveKit accepted all room shutdown requests.
        </p>
      )}
      <Link className="btn-secondary mt-5 inline-flex" href="/dashboard">
        Back to Games
      </Link>
    </section>
  );
}
