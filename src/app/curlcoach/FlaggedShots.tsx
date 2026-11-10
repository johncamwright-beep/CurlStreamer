"use client";
import { useState } from "react";
import type { AnalysisShot } from "@/lib/curlcoach/analysis";
import type { CoachGame } from "@/lib/curlcoach/event";
import type { RosterEntry } from "@/lib/curlcoach/model";
import { parseReviewTime } from "@/lib/curlcoach/flagged-shots";
import {
  reviewStart,
  videoTime,
  type VideoReview,
} from "@/lib/curlcoach/review";
import { standaloneReviewVideo } from "@/lib/curlcoach/standalone-review";
import ReviewVideo from "./ReviewVideo";

function ReviewEditor({
  gameId,
  target,
  video,
  initialNote,
  canSave,
  onSaved,
}: {
  gameId: string;
  target: { shotId: string } | { reviewId: string };
  video?: VideoReview;
  initialNote: string;
  canSave: boolean;
  onSaved: () => Promise<void>;
}) {
  const start = reviewStart(video);
  const [time, setTime] = useState(start === null ? "" : videoTime(start));
  const [note, setNote] = useState(initialNote);
  const [savedStart, setSavedStart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const seconds = parseReviewTime(time);
  async function save() {
    if (busy || !canSave || !video?.url) return;
    if (seconds === null) {
      setMessage("Use m:ss or h:mm:ss, for example 2:12 or 1:02:12.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/curlcoach/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameId,
          ...target,
          requestId: crypto.randomUUID(),
          startSeconds: seconds,
          note,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Unable to save review.");
      }
      setSavedStart(seconds);
      setTime(videoTime(seconds));
      await onSaved();
      setMessage("Review saved.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save review.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <ReviewVideo
        video={
          video && savedStart !== null
            ? {
                url: video.url,
                positionSeconds: savedStart,
                lookBackSeconds: 0,
              }
            : video
        }
      />
      <form
        className="coach-review-edit"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          Video start time
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="2:12 or 1:02:12"
            disabled={busy}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          {[-1, 1].map((offset) => {
            const next = seconds === null ? null : seconds + offset;
            return (
              <button
                key={offset}
                className="btn min-w-11"
                type="button"
                aria-label={
                  offset < 0 ? "One second earlier" : "One second later"
                }
                disabled={busy || next === null || next < 0 || next > 604800}
                onClick={() => next !== null && setTime(videoTime(next))}
              >
                {offset < 0 ? "−1 sec" : "+1 sec"}
              </button>
            );
          })}
        </div>
        <label>
          Coach’s notes
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={4000}
            disabled={busy}
          />
        </label>
        <button
          className="btn"
          type="submit"
          disabled={busy || !canSave || !video?.url}
        >
          {busy ? "Saving…" : "Save review"}
        </button>
      </form>
      {message && <p role="status">{message}</p>}
    </>
  );
}

export default function FlaggedShots({
  shots,
  games,
  players,
  playerId,
  includeStandalone,
  canSave,
  onSaved,
}: {
  shots: AnalysisShot[];
  games: CoachGame[];
  players: RosterEntry[];
  playerId: string;
  includeStandalone: boolean;
  canSave: boolean;
  onSaved: () => Promise<void>;
}) {
  const flagged = shots
    .filter((s) => s.flagged ?? !!s.review)
    .sort(
      (a, b) =>
        (
          games.find((g) => g.id === a.gameId)?.scheduledStart ?? ""
        ).localeCompare(
          games.find((g) => g.id === b.gameId)?.scheduledStart ?? "",
        ) ||
        a.end - b.end ||
        a.stone - b.stone,
    );
  const standalone = includeStandalone
    ? games.flatMap((game) =>
        (game.standaloneReviews ?? [])
          .filter(
            (review) => playerId === "all" || review.playerId === playerId,
          )
          .map((review) => ({ game, review })),
      )
    : [];
  return (
    <section aria-label="Flagged shots">
      <p>
        Review the recording, then save the exact video start time and your
        notes. The review link opens at the saved time.
      </p>
      {!flagged.length && !standalone.length && (
        <p>No flagged shots match these filters.</p>
      )}
      {standalone.map(({ game, review }) => {
        const video = standaloneReviewVideo(review, game.broadcastReview);
        return (
          <article className="event-card" key={`${game.id}:${review.id}`}>
            <h2>
              {review.audience === "team" ? "Team" : review.playerName} ·{" "}
              {game.label} · Video review
            </h2>
            <p>
              vs {game.opponent} ·{" "}
              {review.audience === "team" ? "Team report" : "Player report"}
            </p>
            <ReviewEditor
              key={`${video?.url}:${reviewStart(video)}:${video?.estimated}:${review.note}`}
              gameId={game.id}
              target={{ reviewId: review.id }}
              video={video}
              initialNote={review.note}
              canSave={canSave}
              onSaved={onSaved}
            />
          </article>
        );
      })}
      {flagged.map((shot) => {
        const game = games.find((g) => g.id === shot.gameId);
        const name =
          players.find((p) => p.id === shot.playerId)?.name ?? shot.position;
        const video = shot.videoReview;
        return (
          <article className="event-card" key={`${shot.gameId}:${shot.id}`}>
            <h2>
              {name} · {game?.label} · End {shot.end} · Stone {shot.stone}
            </h2>
            <p>
              vs {game?.opponent} · {shot.type ?? "Shot type not recorded"} ·{" "}
              {shot.grade ?? "—"}/5
            </p>
            <p>
              {shot.flagAudience === "team" ? "Team report" : "Player report"}
            </p>
            <ReviewEditor
              key={`${video?.url}:${reviewStart(video)}:${video?.estimated}:${shot.note}`}
              gameId={shot.gameId}
              target={{ shotId: shot.id }}
              video={video}
              initialNote={shot.note}
              canSave={canSave}
              onSaved={onSaved}
            />
          </article>
        );
      })}
    </section>
  );
}
