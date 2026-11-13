"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { CompletionReview } from "@/lib/game-completion";
import { organizerAccessToken } from "@/lib/access-session";
import { clearCurrentGameIfMatching } from "@/lib/current-game";
import { announceGameCompletion } from "@/lib/dashboard-refresh";
import {
  leaveStudioGame,
  studioGameCompletionEvent,
  studioSessionBridge,
} from "@/lib/studio-session";
import { useStudioSession } from "./StudioSessionContext";
import { StudioOverlay } from "./StudioOverlay";

const finalScoreSchema = z.object({
  home: z.number().int().nonnegative(),
  away: z.number().int().nonnegative(),
});
const resultSchema = z.object({
  outcome: z.enum(["no_result", "tie", "home_win", "away_win"]),
  label: z.string(),
  totals: finalScoreSchema.nullable(),
  ends: z.array(z.unknown()),
});
const reviewSchema = z.object({
  reviewId: z.uuid(),
  inputRevision: z.number().int().nonnegative(),
  result: resultSchema.extend({ totals: finalScoreSchema }),
  youtubeWatchUrl: z.string().nullable(),
});
const completionReplySchema = z
  .object({
    completion: z
      .object({
        status: z.literal("completed"),
        eventName: z.string(),
        homeName: z.string(),
        awayName: z.string(),
        result: resultSchema,
        youtubeWatchUrl: z.string().nullable(),
        completedAt: z.string(),
      })
      .optional(),
    completionSaved: z.literal(true).optional(),
    cleanup: z.object({
      status: z.enum(["pending", "failed", "complete"]),
      attempts: z.number().int().nonnegative(),
      lastError: z.string().nullable(),
    }),
    closing: z
      .object({
        sessionId: z.string().uuid(),
        generation: z.number().int().positive(),
        intentId: z.string().uuid(),
        deadlineAt: z.iso.datetime({ offset: true }),
      })
      .nullable()
      .optional(),
  })
  .refine((value) => Boolean(value.completion || value.completionSaved));

function notifyStudioGameEnded(gameId: string) {
  const bridge = studioSessionBridge();
  if (!bridge) return;
  window.dispatchEvent(
    new CustomEvent(studioGameCompletionEvent, { detail: { gameId } }),
  );
  return new Promise<void>((resolve) => {
    const timer = window.setTimeout(finish, 2000);
    function finish() {
      window.clearTimeout(timer);
      window.removeEventListener("studio-game-ended-ack", acknowledge);
      resolve();
    }
    function acknowledge(event: Event) {
      if ((event as CustomEvent).detail?.gameId === gameId) finish();
    }
    window.addEventListener("studio-game-ended-ack", acknowledge);
    try {
      bridge.postMessage({ type: "studio-game-ended", gameId });
    } catch {
      finish();
    }
  });
}

export function EndGameControl({
  gameId,
  sharedYoutubeWatchUrl = null,
  enabled,
  disabled = false,
  beginCompletion,
  onCompleted,
}: {
  gameId: string;
  sharedYoutubeWatchUrl?: string | null;
  enabled: boolean;
  disabled?: boolean;
  beginCompletion?: () => () => void;
  onCompleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [endChosen, setEndChosen] = useState(false);
  const session = useStudioSession();
  const [review, setReview] = useState<CompletionReview>();
  const [busy, setBusy] = useState(false);
  const [leaveMode, setLeaveMode] = useState<"preview" | "pause" | null>(null);
  const [error, setError] = useState("");
  const [completionSaved, setCompletionSaved] = useState(false);
  const [completionUnconfirmed, setCompletionUnconfirmed] = useState(false);
  const completionFlight = useRef(false);
  const reviewFlight = useRef(false);
  const leaveFlight = useRef(false);
  const broadcastRunning =
    session?.active === true &&
    session.gameId === gameId &&
    session.outputActive;

  function notifyStudio(type: string) {
    studioSessionBridge()?.postMessage({ type, gameId });
  }

  useEffect(() => {
    function requestEndGame(event: Event) {
      if ((event as CustomEvent).detail?.gameId !== gameId) return;
      if (!enabled || disabled) {
        notifyStudio("studio-end-game-unavailable");
        return;
      }
      setOpen(true);
      void reviewScore();
      notifyStudio("studio-end-game-opened");
    }
    window.addEventListener("studio-end-game-request", requestEndGame);
    return () =>
      window.removeEventListener("studio-end-game-request", requestEndGame);
    // The bridge only reports the result of this game-scoped UI request.
    // Authorization and final confirmation remain in the completion endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, enabled, disabled, sharedYoutubeWatchUrl]);

  async function request(body: unknown) {
    const token =
      organizerAccessToken(localStorage, gameId) ??
      localStorage.getItem(`curlcast-access-${gameId}`);
    const response = await fetch(`/api/games/${gameId}/completion`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw Object.assign(new Error(value?.error ?? "End Game failed."), {
        status: response.status,
      });
    if (!value) throw new Error("End Game could not be confirmed.");
    return value;
  }

  async function reviewScore() {
    if (reviewFlight.current || completionFlight.current) return;
    reviewFlight.current = true;
    setEndChosen(true);
    setBusy(true);
    setError("");
    try {
      const value = await request({
        action: "review",
        youtubeWatchUrl: sharedYoutubeWatchUrl ?? "",
        finalScore: "scoreboard",
      });
      setReview(reviewSchema.parse(value));
    } catch (cause) {
      setError(
        cause instanceof Error && !(cause instanceof z.ZodError)
          ? cause.message
          : "The final score could not be loaded.",
      );
    } finally {
      setBusy(false);
      reviewFlight.current = false;
    }
  }

  async function complete() {
    if (
      !review ||
      completionFlight.current ||
      completionUnconfirmed ||
      completionSaved
    )
      return;
    completionFlight.current = true;
    // Keep the operator dialog mounted until the committed game leaves this
    // page, even if a refresh observes the completed result first.
    const releaseRefresh = beginCompletion?.();
    setBusy(true);
    setError("");
    let saved = false;
    try {
      const received = await request({
        action: "complete",
        reviewId: review.reviewId,
      });
      completionReplySchema.parse(received);
      saved = true;
      announceGameCompletion(gameId);
      await notifyStudioGameEnded(gameId);
      try {
        clearCurrentGameIfMatching(localStorage, gameId);
      } catch {
        // Device-local storage is optional during completion.
      }
      setCompletionSaved(true);
      onCompleted();
    } catch (cause) {
      if (saved) {
        window.location.assign("/dashboard");
        return;
      }
      const status = (cause as { status?: number } | null)?.status;
      const rejected = [400, 401, 403, 409].includes(status ?? 0);
      if (!rejected) {
        setCompletionUnconfirmed(true);
        setError(
          "End Game could not be confirmed. Reload this game to check whether the result was saved.",
        );
        return;
      }
      releaseRefresh?.();
      const message =
        cause instanceof Error && !(cause instanceof z.ZodError)
          ? cause.message
          : "End Game failed.";
      setError(message);
      if (status === 409) setReview(undefined);
    } finally {
      completionFlight.current = false;
      setBusy(false);
    }
  }

  async function leaveGame(previewOnly: boolean) {
    if (leaveFlight.current) return;
    leaveFlight.current = true;
    setBusy(true);
    setLeaveMode(previewOnly ? "preview" : "pause");
    setError("");
    try {
      await leaveStudioGame(gameId, { previewOnly });
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not leave this game.",
      );
      setLeaveMode(null);
      setBusy(false);
      leaveFlight.current = false;
    }
  }

  if (!enabled && !session?.canLeaveGame) return null;
  const close = () => {
    if (busy || completionSaved || completionUnconfirmed) return;
    setOpen(false);
    setEndChosen(false);
    setReview(undefined);
    setError("");
    notifyStudio("studio-end-game-cancelled");
  };
  const needsStudioLeave =
    session?.canLeaveGame === true &&
    (!session.active || session.gameId === gameId);
  const resultTotals = review?.result.totals;
  const title = !endChosen
    ? "Is this game completed?"
    : resultTotals
      ? `Finalize game score ${resultTotals.home}–${resultTotals.away}?`
      : "Finalize game score?";
  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          className="min-h-11 min-w-11 rounded-xl border border-red-600 bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || disabled}
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          Close Game
        </button>
      </div>
      {open && (
        <StudioOverlay
          title={title}
          open={open}
          onClose={close}
          dismissible={!busy && !completionSaved && !completionUnconfirmed}
          showCloseButton={false}
          compact
        >
          {!endChosen ? (
            leaveMode ? (
              <div
                role="status"
                aria-live="polite"
                className="flex min-h-11 items-center gap-3"
              >
                <svg
                  aria-hidden="true"
                  className="h-8 w-8 animate-spin text-cyan-300"
                  viewBox="0 0 24 24"
                >
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    opacity="0.2"
                  />
                  <path
                    d="M12 3a9 9 0 0 1 9 9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                </svg>
                <span>
                  {leaveMode === "pause"
                    ? "Pausing the broadcast…"
                    : "Closing camera preview…"}
                </span>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn min-h-11"
                  disabled={busy || disabled || !enabled}
                  onClick={() => void reviewScore()}
                >
                  Yes
                </button>
                <button
                  className="btn-secondary min-h-11"
                  disabled={
                    busy ||
                    disabled ||
                    (broadcastRunning && !needsStudioLeave) ||
                    (needsStudioLeave && session.busy)
                  }
                  onClick={() => {
                    if (needsStudioLeave) void leaveGame(!broadcastRunning);
                    else window.location.assign("/dashboard");
                  }}
                >
                  No
                </button>
                <button
                  className="btn-secondary min-h-11"
                  disabled={busy}
                  onClick={close}
                >
                  Cancel
                </button>
              </div>
            )
          ) : (
            <>
              {busy ? (
                <p role="status" className="mt-3">
                  {review ? "Ending game…" : "Loading final score…"}
                </p>
              ) : completionSaved ? (
                <p role="status" className="mt-3 text-emerald-300">
                  Game ended. Returning to Games…
                </p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-3">
                  {completionUnconfirmed ? (
                    <button
                      className="btn-secondary min-h-11"
                      onClick={() => window.location.reload()}
                    >
                      Reload game
                    </button>
                  ) : (
                    <>
                      {resultTotals ? (
                        <button
                          className="btn min-h-11"
                          disabled={disabled}
                          onClick={() => void complete()}
                        >
                          Yes
                        </button>
                      ) : (
                        <button
                          className="btn min-h-11"
                          disabled={disabled}
                          onClick={() => void reviewScore()}
                        >
                          Reload final score
                        </button>
                      )}
                      <button
                        className="btn-secondary min-h-11"
                        onClick={close}
                      >
                        No
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
        </StudioOverlay>
      )}
    </div>
  );
}
