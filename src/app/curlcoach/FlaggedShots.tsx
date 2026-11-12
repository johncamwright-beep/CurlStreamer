"use client";
import { useState } from "react";
import type { AnalysisShot } from "@/lib/curlcoach/analysis";
import type { CoachGame } from "@/lib/curlcoach/event";
import type { RosterEntry } from "@/lib/curlcoach/model";
import { parseReviewTime } from "@/lib/curlcoach/flagged-shots";
import {
  recordingLink,
  reviewLink,
  reviewStart,
  videoTime,
  youtubeId,
  type VideoReview,
} from "@/lib/curlcoach/review";
import { standaloneReviewVideo } from "@/lib/curlcoach/standalone-review";

function FlagVideo({
  gameId,
  target,
  video,
  note,
  canSave,
  onSaved,
}: {
  gameId: string;
  target: { shotId: string } | { reviewId: string };
  video?: VideoReview;
  note: string;
  canSave: boolean;
  onSaved: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [time, setTime] = useState("");
  const [savedStart, setSavedStart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const recording = recordingLink(video);
  const canAdjust = !!(canSave && recording && youtubeId(new URL(recording)));
  const link = reviewLink(
    video && savedStart !== null
      ? { url: video.url, positionSeconds: savedStart, lookBackSeconds: 0 }
      : video,
  );

  function edit() {
    const start = savedStart ?? reviewStart(video);
    setTime(start === null ? "" : videoTime(start));
    setMessage("");
    setEditing(true);
  }

  async function save() {
    if (busy || !canAdjust) return;
    const seconds = parseReviewTime(time);
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
        throw new Error(result?.error || "Unable to save timestamp.");
      }
      setSavedStart(seconds);
      setEditing(false);
      await onSaved().catch(() => undefined);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Unable to save timestamp.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3">
        {link ? (
          <a
            className="inline-flex min-h-11 items-center"
            href={link}
            target="_blank"
            rel="noopener noreferrer"
          >
            Link to video
          </a>
        ) : (
          <span>
            {recording ? "Timestamp unavailable" : "Video link unavailable"}
          </span>
        )}
        {canAdjust && !editing && (
          <button
            className="btn min-h-11"
            type="button"
            disabled={busy}
            onClick={edit}
          >
            Adjust timestamp
          </button>
        )}
      </div>
      {note && <p className="whitespace-pre-wrap break-words">{note}</p>}
      {editing && (
        <form
          className="coach-review-edit"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Timestamp
            <input
              value={time}
              onChange={(event) => setTime(event.target.value)}
              placeholder="m:ss or h:mm:ss"
              disabled={busy}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save timestamp"}
            </button>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          {message && <p role="status">{message}</p>}
        </form>
      )}
    </>
  );
}

export default function FlaggedShots({
  shots,
  games,
  players,
  playerId,
  canSave,
  onSaved,
}: {
  shots: AnalysisShot[];
  games: CoachGame[];
  players: RosterEntry[];
  playerId: string;
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
  const standalone = games.flatMap((game) =>
    (game.standaloneReviews ?? [])
      .filter((review) => playerId === "all" || review.playerId === playerId)
      .map((review) => ({ game, review })),
  );
  return (
    <section aria-label="Flagged shots">
      {!flagged.length && !standalone.length && (
        <p>No flagged shots match these filters.</p>
      )}
      {standalone.map(({ game, review }) => {
        const video = standaloneReviewVideo(review, game.broadcastReview);
        return (
          <article className="event-card" key={`${game.id}:${review.id}`}>
            <h2>{review.audience === "team" ? "Team" : review.playerName}</h2>
            <p>
              {game.label} · vs {game.opponent}
            </p>
            <FlagVideo
              key={`${video?.url}:${reviewStart(video)}:${video?.estimated}:${review.note}`}
              gameId={game.id}
              target={{ reviewId: review.id }}
              video={video}
              note={review.note}
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
            <h2>{name}</h2>
            <p>
              {game && `${game.label} · vs ${game.opponent} · `}
              End {shot.end} · Shot {shot.stone}
              {shot.type && ` · ${shot.type}`}
            </p>
            <FlagVideo
              key={`${video?.url}:${reviewStart(video)}:${video?.estimated}:${shot.note}`}
              gameId={shot.gameId}
              target={{ shotId: shot.id }}
              video={video}
              note={shot.note}
              canSave={canSave}
              onSaved={onSaved}
            />
          </article>
        );
      })}
    </section>
  );
}
