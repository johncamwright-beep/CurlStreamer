"use client";
import { useState } from "react";
import type { AnalysisShot } from "@/lib/curlcoach/analysis";
import type { CoachGame } from "@/lib/curlcoach/event";
import type { RosterEntry } from "@/lib/curlcoach/model";
import { parseReviewTime } from "@/lib/curlcoach/flagged-shots";
import { reviewStart, videoTime } from "@/lib/curlcoach/review";
import ReviewVideo from "./ReviewVideo";

function Flag({
  shot,
  game,
  name,
  canSave,
  onSaved,
}: {
  shot: AnalysisShot;
  game?: CoachGame;
  name: string;
  canSave: boolean;
  onSaved: () => Promise<void>;
}) {
  const start = reviewStart(shot.videoReview);
  const [time, setTime] = useState(start === null ? "" : videoTime(start));
  const [note, setNote] = useState(shot.note);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
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
          gameId: shot.gameId,
          shotId: shot.id,
          requestId: crypto.randomUUID(),
          startSeconds: seconds,
          note,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to save review.");
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
    <article className="event-card">
      <h2>
        {name} · {game?.label} · End {shot.end} · Stone {shot.stone}
      </h2>
      <p>
        vs {game?.opponent} · {shot.type ?? "Shot type not recorded"} ·{" "}
        {shot.grade ?? "—"}/5
      </p>
      <ReviewVideo video={shot.videoReview} />
      <div className="coach-review-edit">
        <label>
          Video start time
          <input
            value={time}
            onChange={(e) => setTime(e.target.value)}
            placeholder="2:12 or 1:02:12"
            disabled={busy}
          />
        </label>
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
          onClick={() => void save()}
          disabled={busy || !canSave || !shot.videoReview?.url}
        >
          {busy ? "Saving…" : "Save review"}
        </button>
      </div>
      {message && <p role="status">{message}</p>}
    </article>
  );
}
export default function FlaggedShots({
  shots,
  games,
  players,
  canSave,
  onSaved,
}: {
  shots: AnalysisShot[];
  games: CoachGame[];
  players: RosterEntry[];
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
  return (
    <section aria-label="Flagged shots">
      <p>
        Review the recording, then save the exact video start time and your
        notes. The saved time is used directly, without subtracting the go-back
        setting.
      </p>
      {!flagged.length && <p>No flagged shots match these filters.</p>}
      {flagged.map((shot) => (
        <Flag
          key={`${shot.gameId}:${shot.id}:${shot.videoReview?.positionSeconds}:${shot.note}`}
          shot={shot}
          game={games.find((g) => g.id === shot.gameId)}
          name={
            players.find((p) => p.id === shot.playerId)?.name ?? shot.position
          }
          canSave={canSave}
          onSaved={onSaved}
        />
      ))}
    </section>
  );
}
