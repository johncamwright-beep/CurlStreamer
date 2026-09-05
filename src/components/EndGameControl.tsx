"use client";
import { useState } from "react";
import type {
  CompletionCleanup,
  CompletionReview,
  SafeGameCompletion,
} from "@/lib/game-completion";
import { organizerAccessToken } from "@/lib/access-session";

export function EndGameControl({
  gameId,
  homeName,
  awayName,
  enabled,
  disabled = false,
  onCompleted,
}: {
  gameId: string;
  homeName: string;
  awayName: string;
  enabled: boolean;
  disabled?: boolean;
  onCompleted: (
    completion: SafeGameCompletion,
    cleanup: CompletionCleanup,
  ) => void;
}) {
  const [open, setOpen] = useState(false);
  const [watchUrl, setWatchUrl] = useState("");
  const [review, setReview] = useState<CompletionReview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [completionSaved, setCompletionSaved] = useState(false);

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
    });
    const value = await response.json().catch(() => null);
    if (!response.ok) throw new Error(value?.error ?? "End Game failed.");
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
    if (!review) return;
    setBusy(true);
    setError("");
    try {
      const value = await request({
        action: "complete",
        reviewId: review.reviewId,
      });
      if (value.completion) onCompleted(value.completion, value.cleanup);
      else if (value.completionSaved) {
        setCompletionSaved(true);
        window.setTimeout(() => window.location.reload(), 500);
      }
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "End Game failed.";
      setError(message);
      if (message.includes("Review the final score again"))
        setReview(undefined);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <div>
      <button
        className="btn-secondary border-red-700 text-red-200"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        End Game
      </button>
      {open && (
        <section
          className="mt-4 rounded-xl border border-red-800 p-4"
          aria-labelledby="end-game-heading"
        >
          <h3 id="end-game-heading" className="text-xl font-bold">
            End Game
          </h3>
          {!review ? (
            <>
              <p className="mt-2 text-slate-300">
                Review the final score before permanently ending scoring and
                live video.
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
                  Visible to viewers on the completed-game page.
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
                  onClick={() => setOpen(false)}
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
                This result is final and cannot be edited. All participants will
                be disconnected.
              </p>
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
        </section>
      )}
    </div>
  );
}
