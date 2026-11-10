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
import {
  canCloseStudioGameDirectly,
  leaveStudioGame,
} from "@/lib/studio-session";
import { useStudioSession } from "./StudioSessionContext";
import { StudioOverlay } from "./StudioOverlay";

const completionReplySchema = z
  .object({
    completion: z
      .object({
        status: z.literal("completed"),
        eventName: z.string(),
        homeName: z.string(),
        awayName: z.string(),
        result: z.object({
          outcome: z.enum(["no_result", "tie", "home_win", "away_win"]),
          label: z.string(),
          totals: z
            .object({
              home: z.number().int().nonnegative(),
              away: z.number().int().nonnegative(),
            })
            .nullable(),
          ends: z.array(z.unknown()),
        }),
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
  const [watchUrl, setWatchUrl] = useState(sharedYoutubeWatchUrl ?? "");
  const [review, setReview] = useState<CompletionReview>();
  const [busy, setBusy] = useState(false);
  const [leavingPreview, setLeavingPreview] = useState(false);
  const [error, setError] = useState("");
  const [completionSaved, setCompletionSaved] = useState(false);
  const [canGracefulEnd, setCanGracefulEnd] = useState(false);
  const completionFlight = useRef(false);
  const leaveFlight = useRef(false);

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

  function endingProgress(active: boolean) {
    window.dispatchEvent(
      new CustomEvent("studio-ending-progress", {
        detail: { gameId, active },
      }),
    );
  }

  function notifyStudio(type: string) {
    const bridge = (
      window as Window & {
        chrome?: { webview?: { postMessage: (message: unknown) => void } };
      }
    ).chrome?.webview;
    bridge?.postMessage({ type, gameId });
  }

  useEffect(() => {
    function requestEndGame(event: Event) {
      if ((event as CustomEvent).detail?.gameId !== gameId) return;
      if ((!enabled && !session?.canLeaveGame) || disabled) {
        notifyStudio("studio-end-game-unavailable");
        return;
      }
      setOpen(true);
      setEndChosen(false);
      notifyStudio("studio-end-game-opened");
    }
    window.addEventListener("studio-end-game-request", requestEndGame);
    return () =>
      window.removeEventListener("studio-end-game-request", requestEndGame);
    // The bridge only reports the result of this game-scoped UI request.
    // Authorization and final confirmation remain in the completion endpoint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, enabled, disabled, session?.canLeaveGame]);

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

  async function reviewScore() {
    setBusy(true);
    setError("");
    try {
      setReview(await request({ action: "review", youtubeWatchUrl: watchUrl }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function complete() {
    if (!review || completionFlight.current) return;
    completionFlight.current = true;
    setBusy(true);
    setError("");
    let prepared = false;
    let committed = false;
    if (canGracefulEnd) endingProgress(true);
    try {
      let closing: StudioClosingPreparation | null | undefined;
      if (canGracefulEnd) {
        const receipt = await requestStudioPresentation(gameId, "prepare");
        prepared = true;
        closing = receipt.closing;
      }
      const received = await request({
        action: "complete",
        reviewId: review.reviewId,
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
      if (prepared && !committed) {
        // A missing HTTP response can follow a successful database commit.
        // Never return to live video on that ambiguous outcome.
        const rejected =
          (cause as { definitelyNotCommitted?: boolean } | null)
            ?.definitelyNotCommitted === true;
        await requestStudioPresentation(
          gameId,
          rejected ? "cancel" : "finish",
          {},
          6000,
        ).catch(() => undefined);
      }
      const message =
        cause instanceof Error ? cause.message : "End Game failed.";
      setError(message);
      if (message.includes("Review the final score again"))
        setReview(undefined);
    } finally {
      if (canGracefulEnd) endingProgress(false);
      completionFlight.current = false;
      setBusy(false);
    }
  }

  async function leaveGame(previewOnly: boolean) {
    if (leaveFlight.current) return;
    leaveFlight.current = true;
    setBusy(true);
    setLeavingPreview(previewOnly);
    setError("");
    try {
      await leaveStudioGame(gameId, { previewOnly });
      window.location.assign("/dashboard");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not leave this game.",
      );
      setLeavingPreview(false);
      setBusy(false);
      leaveFlight.current = false;
    }
  }

  if (!enabled && !session?.canLeaveGame) return null;
  const close = () => {
    if (busy) return;
    setOpen(false);
    setEndChosen(false);
    setReview(undefined);
    setError("");
    notifyStudio("studio-end-game-cancelled");
  };
  const canLeave =
    session?.canLeaveGame &&
    (!session.active || session.gameId === gameId) &&
    !session.busy;
  const directClose = canCloseStudioGameDirectly(session, gameId);
  const previewClose = directClose || leavingPreview;
  const buttonLabel = previewClose ? "Close game" : "Game options";
  return (
    <div>
      <div className="flex flex-wrap justify-end gap-2">
        {previewClose && enabled && (
          <button
            className="btn-secondary min-h-11"
            disabled={busy || disabled}
            onClick={() => {
              setError("");
              setEndChosen(true);
              setOpen(true);
            }}
          >
            End game
          </button>
        )}
        <button
          className="btn-secondary min-h-11 min-w-11 border-red-700 text-red-200"
          aria-label={buttonLabel}
          title={previewClose ? "Close game" : "Leave or end game"}
          disabled={busy || disabled}
          onClick={() => {
            setError("");
            if (directClose) void leaveGame(true);
            else setOpen(true);
          }}
        >
          ×
        </button>
      </div>
      {leavingPreview && (
        <p role="status" className="mt-2 text-sm text-slate-300">
          Closing camera preview…
        </p>
      )}
      {!open && error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {open && (
        <StudioOverlay
          title={endChosen ? "End game and stream" : "Leave or end game"}
          open={open}
          onClose={close}
          dismissible={!busy}
        >
          {!endChosen ? (
            busy ? (
              <div
                role="status"
                aria-live="polite"
                className="flex min-h-36 items-center justify-center gap-4"
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
                <span>Pausing the broadcast and closing cameras…</span>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  <button
                    className="btn-secondary min-h-11"
                    disabled={busy || disabled || !canLeave}
                    onClick={() => void leaveGame(false)}
                  >
                    Leave game and pause stream
                  </button>
                  <button
                    className="btn min-h-11 border-red-700"
                    disabled={busy || disabled || !enabled}
                    onClick={() => {
                      setEndChosen(true);
                      setError("");
                    }}
                  >
                    End game and stream
                  </button>
                </div>
              </>
            )
          ) : !review ? (
            <>
              <p className="mt-2 text-slate-300">
                Review the final score before ending scoring and live video.
              </p>
              <label className="mt-4 block font-bold">
                YouTube watch link (optional)
                <input
                  className="mt-2 min-h-11 w-full rounded-lg bg-slate-800 px-3"
                  type="url"
                  value={watchUrl}
                  onChange={(event) => setWatchUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=…"
                />
                <span className="mt-2 block text-sm font-normal text-slate-400">
                  Visible to viewers on the completed-game page. A shared link
                  from game setup is filled in automatically.
                </span>
              </label>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="btn"
                  disabled={busy || disabled}
                  onClick={reviewScore}
                >
                  {busy ? "Reviewing…" : "Review final score"}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    close();
                  }}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mt-3 text-2xl font-black">
                {review.result.totals
                  ? `${homeName} ${review.result.totals.home} – ${review.result.totals.away} ${awayName}`
                  : review.result.label}
              </p>
              {review.youtubeWatchUrl && (
                <p className="mt-2 break-all text-slate-300">
                  YouTube: {review.youtubeWatchUrl}
                </p>
              )}
              <p className="mt-2 text-amber-200">
                This ends scoring. Your team owner or administrator can correct
                the saved result later from Edit game. All participants will be
                disconnected.
              </p>
              {canGracefulEnd && (
                <p className="mt-2 text-slate-300">
                  Viewers will see the saved final score briefly before the
                  broadcast ends.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  className="btn border-red-700"
                  disabled={busy || disabled}
                  onClick={complete}
                >
                  {busy ? "Ending…" : "Confirm End Game"}
                </button>
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => setReview(undefined)}
                >
                  Back
                </button>
              </div>
            </>
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
        </StudioOverlay>
      )}
    </div>
  );
}
