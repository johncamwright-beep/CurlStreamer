"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import type {
  CompletionCleanup,
  CompletionReview,
  SafeGameCompletion,
} from "@/lib/game-completion";
import { organizerAccessToken } from "@/lib/access-session";
import { announceGameCompletion } from "@/lib/dashboard-refresh";
import { requestStudioPresentation } from "@/lib/studio-presentation-client";
import type { StudioClosingPreparation } from "@/lib/studio-presentation-client";
import { leaveStudioGame, studioSessionBridge } from "@/lib/studio-session";
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
  result: resultSchema,
  youtubeWatchUrl: z.string().nullable(),
});
type FinalScore = z.infer<typeof finalScoreSchema>;

function scoreValue(value: string) {
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

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

const workspaceCloseReceiptSchema = z
  .object({
    type: z.literal("studio-close-workspace-result").optional(),
    gameId: z.uuid(),
    nonce: z.uuid(),
    ok: z.boolean(),
    error: z.string().max(300).nullable().optional(),
  })
  .strict();

export function EndGameControl({
  gameId,
  homeName,
  awayName,
  sharedYoutubeWatchUrl = null,
  enabled,
  disabled = false,
  onCompleted,
}: {
  gameId: string;
  homeName: string;
  awayName: string;
  sharedYoutubeWatchUrl?: string | null;
  enabled: boolean;
  disabled?: boolean;
  onCompleted: (
    completion: SafeGameCompletion,
    cleanup: CompletionCleanup,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [endChosen, setEndChosen] = useState(false);
  const session = useStudioSession();
  const [review, setReview] = useState<CompletionReview>();
  const [score, setScore] = useState({ home: "", away: "" });
  const [busy, setBusy] = useState(false);
  const [leaveMode, setLeaveMode] = useState<"preview" | "pause" | null>(null);
  const [error, setError] = useState("");
  const [completionSaved, setCompletionSaved] = useState(false);
  const [canGracefulEnd, setCanGracefulEnd] = useState(false);
  const [prepareFailed, setPrepareFailed] = useState(false);
  const [completionUnconfirmed, setCompletionUnconfirmed] = useState(false);
  const [canForceClose, setCanForceClose] = useState(false);
  const [closingStudio, setClosingStudio] = useState<
    "closing" | "waiting" | "confirmed" | null
  >(null);
  const completionFlight = useRef(false);
  const reviewFlight = useRef(false);
  const leaveFlight = useRef(false);
  const closeWorkspaceNonce = useRef<string | null>(null);

  useEffect(() => {
    function status(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.gameId !== gameId) return;
      setCanGracefulEnd(
        detail.available === true && detail.canGracefulEnd === true,
      );
    }
    window.addEventListener("studio-youtube-status", status);
    return () => window.removeEventListener("studio-youtube-status", status);
  }, [gameId]);

  useEffect(() => {
    function recoveryStatus(event: Event) {
      const detail = (event as CustomEvent).detail;
      if (detail?.gameId === gameId)
        setCanForceClose(detail.canForceClose === true);
    }
    function closed(event: Event) {
      const reply = workspaceCloseReceiptSchema.safeParse(
        (event as CustomEvent).detail,
      );
      if (
        !reply.success ||
        reply.data.gameId !== gameId ||
        reply.data.nonce !== closeWorkspaceNonce.current
      )
        return;
      closeWorkspaceNonce.current = null;
      setClosingStudio(reply.data.ok ? "confirmed" : null);
      if (!reply.data.ok)
        setError(reply.data.error || "Studio did not close. Try again.");
    }
    window.addEventListener("studio-recovery-status", recoveryStatus);
    window.addEventListener("studio-close-workspace-result", closed);
    studioSessionBridge()?.postMessage({ type: "studio-session-observe" });
    return () => {
      closeWorkspaceNonce.current = null;
      window.removeEventListener("studio-recovery-status", recoveryStatus);
      window.removeEventListener("studio-close-workspace-result", closed);
    };
  }, [gameId]);

  useEffect(() => {
    if (closingStudio !== "closing") return;
    const timer = window.setTimeout(() => setClosingStudio("waiting"), 45000);
    return () => window.clearTimeout(timer);
  }, [closingStudio]);

  function endingProgress(active: boolean) {
    window.dispatchEvent(
      new CustomEvent("studio-ending-progress", {
        detail: { gameId, active },
      }),
    );
  }

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
      signal: AbortSignal.timeout(20000),
    });
    const value = await response.json().catch(() => null);
    if (!response.ok)
      throw Object.assign(new Error(value?.error ?? "End Game failed."), {
        definitelyNotCommitted: [400, 401, 403, 409].includes(response.status),
      });
    if (!value) throw new Error("End Game could not be confirmed.");
    return value;
  }

  async function requestReview(finalScore?: FinalScore | null) {
    const value = await request({
      action: "review",
      youtubeWatchUrl: sharedYoutubeWatchUrl ?? "",
      ...(finalScore === undefined ? {} : { finalScore }),
    });
    return reviewSchema.parse(value);
  }

  async function reviewScore() {
    if (reviewFlight.current || completionFlight.current) return;
    reviewFlight.current = true;
    setEndChosen(true);
    setBusy(true);
    setError("");
    setPrepareFailed(false);
    try {
      const next = await requestReview();
      setReview(next);
      const totals = next.result.totals;
      setScore({
        home: totals ? String(totals.home) : "",
        away: totals ? String(totals.away) : "",
      });
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

  async function complete(
    mode: "standard" | "without-card",
    finalScore?: FinalScore | null,
  ) {
    if (
      !review ||
      completionFlight.current ||
      completionUnconfirmed ||
      completionSaved
    )
      return;
    completionFlight.current = true;
    setBusy(true);
    setError("");
    const shouldPrepare =
      mode === "standard" && (canGracefulEnd || prepareFailed);
    let prepared = false;
    let submitting = false;
    let committed = false;
    if (shouldPrepare) endingProgress(true);
    try {
      let selected = review;
      if (
        finalScore === null ||
        (finalScore &&
          (finalScore.home !== review.result.totals?.home ||
            finalScore.away !== review.result.totals?.away))
      ) {
        selected = await requestReview(finalScore);
        setReview(selected);
      }
      let closing: StudioClosingPreparation | null | undefined;
      if (shouldPrepare) {
        try {
          const receipt = await requestStudioPresentation(gameId, "prepare");
          if (!receipt.closing)
            throw new Error("Studio could not prepare the final screen.");
          closing = receipt.closing;
        } catch {
          setPrepareFailed(true);
          setError(
            "Studio could not confirm the final screen. Your game is still open.",
          );
          return;
        }
        prepared = true;
      }
      submitting = true;
      const received = await request({
        action: "complete",
        reviewId: selected.reviewId,
        ...(closing ? { closing } : {}),
      });
      const parsed = completionReplySchema.safeParse(received);
      if (!parsed.success) throw new Error("End Game could not be confirmed.");
      const value = parsed.data;
      committed = Boolean(value.completion || value.completionSaved);
      if (committed) announceGameCompletion(gameId);
      if (prepared && value.closing) {
        try {
          // Only the committed server snapshot may become a Game over card.
          // Studio confirms a painted card, dwells, then acknowledges output Stop.
          if (value.completion)
            await requestStudioPresentation(gameId, "show", {
              completion: value.completion,
              closing: value.closing,
            });
        } catch {
          // The result remains saved. Never hold the game open or invent a
          // displayed final score when the renderer cannot acknowledge it.
        }
        try {
          await requestStudioPresentation(gameId, "finish", {}, 6000);
        } catch {
          // The immutable server deadline also fences the native output.
        }
        value.cleanup = await request({ action: "retry-cleanup" }).catch(
          () => value.cleanup,
        );
      } else if (prepared) {
        await requestStudioPresentation(gameId, "cancel").catch(
          () => undefined,
        );
      }
      if (value.completion) onCompleted(value.completion, value.cleanup);
      else if (value.completionSaved) {
        setCompletionSaved(true);
        window.setTimeout(() => window.location.reload(), 500);
      }
    } catch (cause) {
      const rejected =
        (cause as { definitelyNotCommitted?: boolean } | null)
          ?.definitelyNotCommitted === true;
      if (prepared && !committed) {
        // A missing HTTP response can follow a successful database commit.
        // Never return to live video on that ambiguous outcome.
        await requestStudioPresentation(
          gameId,
          rejected ? "cancel" : "finish",
          {},
          6000,
        ).catch(() => undefined);
      }
      if (submitting && !committed && !rejected) {
        setCompletionUnconfirmed(true);
        setError(
          "End Game could not be confirmed. Reopen this game to check whether the result was saved.",
        );
        return;
      }
      const message =
        cause instanceof Error && !(cause instanceof z.ZodError)
          ? cause.message
          : "End Game failed.";
      setError(message);
      if (message.includes("Review the final score again")) {
        setPrepareFailed(false);
        setReview(undefined);
      }
    } finally {
      if (shouldPrepare) endingProgress(false);
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

  function closeStudio() {
    if (closeWorkspaceNonce.current) return;
    const bridge = studioSessionBridge();
    if (!bridge) {
      setError("Windows Studio is unavailable.");
      return;
    }
    const nonce = crypto.randomUUID();
    closeWorkspaceNonce.current = nonce;
    setClosingStudio("closing");
    try {
      bridge.postMessage({ type: "studio-close-workspace", gameId, nonce });
    } catch {
      closeWorkspaceNonce.current = null;
      setClosingStudio(null);
      setError("Windows Studio is unavailable.");
    }
  }

  if (!enabled && !session?.canLeaveGame) return null;
  const close = () => {
    if (busy || closingStudio) return;
    setOpen(false);
    setEndChosen(false);
    setReview(undefined);
    setError("");
    setPrepareFailed(false);
    setCompletionUnconfirmed(false);
    notifyStudio("studio-end-game-cancelled");
  };
  const broadcastRunning =
    session?.active === true &&
    session.gameId === gameId &&
    session.outputActive;
  const canLeave =
    session?.canLeaveGame === true &&
    (!session.active || session.gameId === gameId) &&
    !session.busy;
  const needsPreviewClose =
    session?.canLeaveGame === true &&
    (!session.active || session.gameId === gameId);
  const canCloseWorkspace =
    session?.canCloseWorkspace &&
    (!session.active || session.gameId === gameId);
  const editableScore = finalScoreSchema.safeParse({
    home: scoreValue(score.home),
    away: scoreValue(score.away),
  });
  const scoreLocked = busy || disabled || !!closingStudio || completionSaved;
  const showReviewedResult =
    prepareFailed || completionUnconfirmed || completionSaved;
  const resultTotals = review?.result.totals;
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
      {!open && error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {open && (
        <StudioOverlay
          title={
            endChosen
              ? "Final score"
              : broadcastRunning
                ? "Broadcast is running"
                : "Is the game done?"
          }
          open={open}
          onClose={close}
          dismissible={!busy && !closingStudio}
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
                {broadcastRunning && (
                  <button
                    className="btn-secondary min-h-11"
                    disabled={busy || disabled || !canLeave || !!closingStudio}
                    onClick={() => void leaveGame(false)}
                  >
                    Pause and leave
                  </button>
                )}
                <button
                  className="btn min-h-11"
                  disabled={busy || disabled || !enabled || !!closingStudio}
                  onClick={() => void reviewScore()}
                >
                  {broadcastRunning ? "End Game" : "Yes"}
                </button>
                {!broadcastRunning && (
                  <button
                    className="btn-secondary min-h-11"
                    disabled={
                      busy ||
                      disabled ||
                      !!closingStudio ||
                      (needsPreviewClose && !canLeave)
                    }
                    onClick={() => {
                      if (needsPreviewClose) void leaveGame(true);
                      else window.location.assign("/dashboard");
                    }}
                  >
                    No
                  </button>
                )}
                <button
                  className="btn-secondary min-h-11"
                  disabled={busy || !!closingStudio}
                  onClick={close}
                >
                  Cancel
                </button>
              </div>
            )
          ) : !review ? (
            busy ? (
              <p role="status">Loading final score…</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                <button
                  className="btn min-h-11"
                  disabled={disabled || !!closingStudio}
                  onClick={() => void reviewScore()}
                >
                  Reload final score
                </button>
                <button
                  className="btn-secondary min-h-11"
                  onClick={close}
                  disabled={!!closingStudio}
                >
                  Cancel
                </button>
              </div>
            )
          ) : showReviewedResult ? (
            <>
              <p className="text-xl font-bold">
                {resultTotals
                  ? `${homeName} ${resultTotals.home} – ${resultTotals.away} ${awayName}`
                  : review.result.label}
              </p>
              {!completionSaved && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {prepareFailed && !completionUnconfirmed && (
                    <>
                      <button
                        className="btn min-h-11"
                        disabled={scoreLocked}
                        onClick={() => void complete("without-card")}
                      >
                        {busy ? "Ending…" : "End game without final screen"}
                      </button>
                      <button
                        className="btn-secondary min-h-11"
                        disabled={scoreLocked}
                        onClick={() => void complete("standard")}
                      >
                        Retry final screen
                      </button>
                    </>
                  )}
                  <button
                    className="btn-secondary min-h-11"
                    disabled={busy || !!closingStudio}
                    onClick={() => {
                      if (completionUnconfirmed) {
                        close();
                        return;
                      }
                      setPrepareFailed(false);
                      setError("");
                    }}
                  >
                    {completionUnconfirmed ? "Back to game" : "Back"}
                  </button>
                </div>
              )}
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (editableScore.success && !scoreLocked)
                  void complete("standard", editableScore.data);
              }}
            >
              <div className="grid grid-cols-2 gap-3">
                {(["home", "away"] as const).map((side) => (
                  <label key={side} className="block font-bold">
                    {side === "home" ? homeName : awayName}
                    <input
                      className="mt-2 min-h-11 w-full rounded-lg bg-slate-800 px-3"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={Number.MAX_SAFE_INTEGER}
                      step={1}
                      value={score[side]}
                      disabled={scoreLocked}
                      onChange={(event) =>
                        setScore({ ...score, [side]: event.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="btn min-h-11"
                  disabled={scoreLocked || !editableScore.success}
                  type="submit"
                >
                  {busy ? "Ending…" : "End Game"}
                </button>
                <button
                  className="btn-secondary min-h-11"
                  type="button"
                  disabled={scoreLocked}
                  onClick={() => void complete("standard", null)}
                >
                  End without score
                </button>
                <button
                  className="btn-secondary min-h-11"
                  type="button"
                  disabled={busy || !!closingStudio}
                  onClick={() => {
                    setEndChosen(false);
                    setReview(undefined);
                    setError("");
                  }}
                >
                  Back
                </button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-3 text-red-300">
              {error}
            </p>
          )}
          {completionSaved && (
            <p role="status" className="mt-3 text-emerald-300">
              Game ended. Loading the saved final result…
            </p>
          )}
          {((canCloseWorkspace && (error || closingStudio)) ||
            canForceClose) && (
            <div className="mt-4 border-t border-slate-700 pt-4">
              <div className="flex flex-wrap gap-3">
                {canCloseWorkspace && (error || closingStudio) && (
                  <button
                    className="btn-secondary min-h-11"
                    disabled={busy || !!closingStudio}
                    onClick={closeStudio}
                  >
                    Close Studio without ending game
                  </button>
                )}
                {canForceClose && (
                  <button
                    className="btn-secondary min-h-11 border-red-700 text-red-200"
                    onClick={() => notifyStudio("studio-force-close")}
                  >
                    Force close Studio
                  </button>
                )}
              </div>
              {closingStudio && (
                <p role="status" className="mt-2 text-sm text-slate-300">
                  {closingStudio === "waiting"
                    ? "Studio is still closing. Check for a Windows confirmation prompt."
                    : "Closing Studio…"}
                </p>
              )}
            </div>
          )}
        </StudioOverlay>
      )}
    </div>
  );
}
