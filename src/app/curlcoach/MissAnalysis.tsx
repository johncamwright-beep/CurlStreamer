"use client";
import { useState } from "react";
import { deficiencies, shotTypes, type Shot } from "@/lib/curlcoach/model";
import { family, type CoachGame } from "@/lib/curlcoach/event";
import { isMiss } from "@/lib/curlcoach/misses";
import { reviewLink, reviewStart, videoTime } from "@/lib/curlcoach/review";
export default function MissAnalysis({
  shots,
  games,
  players,
}: {
  shots: (Shot & { id: string; gameId: string })[];
  games: CoachGame[];
  players: readonly { id: string; name: string }[];
}) {
  const [type, setType] = useState("all");
  const [reason, setReason] = useState("all");
  const [focus, setFocus] = useState("misses");
  const typed = shots.filter(
    (s) =>
      !s.excluded && (type === "all" || s.type === type || family(s) === type),
  );
  const focused = typed.filter((s) =>
    focus === "flags"
      ? (s.flagged ?? !!s.review)
      : focus === "notes"
        ? !!s.note.trim()
        : focus === "complete"
          ? s.execution === "Xmiss" || s.grade === 0
          : isMiss(s),
  );
  const visible = focused
    .filter(
      (s) => reason === "all" || (s.deficiency ?? "unrecorded") === reason,
    )
    .slice()
    .reverse();
  return (
    <>
      <div className="event-analysis-filters">
        <label>
          Shot type
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">All shots</option>
            {["Draws", "Hits", ...shotTypes].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <label>
          Review
          <select value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="misses">Partial or missed shots</option>
            <option value="complete">Complete misses (Xmiss / 0)</option>
            <option value="flags">Flagged shots</option>
            <option value="notes">Shots with notes</option>
          </select>
        </label>
        <label>
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="all">All reasons</option>
            {deficiencies.map((r) => (
              <option key={r}>{r}</option>
            ))}
            <option value="unrecorded">Not recorded</option>
          </select>
        </label>
      </div>
      <div className="event-metrics event-shot-metrics">
        <div>
          <span>Shots</span>
          <strong>{visible.length}</strong>
        </div>
        <div>
          <span>Flagged</span>
          <strong>
            {visible.filter((s) => s.flagged ?? !!s.review).length}
          </strong>
        </div>
        <div>
          <span>With notes</span>
          <strong>{visible.filter((s) => s.note.trim()).length}</strong>
        </div>
        <div>
          <span>No reason</span>
          <strong>{visible.filter((s) => !s.deficiency).length}</strong>
        </div>
      </div>
      <section className="event-card">
        <h3>Reasons</h3>
        <div className="coach-miss-reasons">
          {[...deficiencies, "unrecorded"].map((r) => {
            const count = visible.filter(
              (s) => (s.deficiency ?? "unrecorded") === r,
            ).length;
            return count ? (
              <div key={r}>
                <span>{r === "unrecorded" ? "Not recorded" : r}</span>
                <strong>{count}</strong>
              </div>
            ) : null;
          })}
        </div>
        {!visible.length && <p>No shots match these filters.</p>}
      </section>
      <section className="event-card" aria-label="Miss review shots">
        <h3>Shot review</h3>
        {visible.map((s) => {
          const game = games.find((g) => g.id === s.gameId);
          const link = reviewLink(s.videoReview);
          return (
            <article className="coach-review-item" key={s.gameId + ":" + s.id}>
              <h4>
                {players.find((p) => p.id === s.playerId)?.name ?? s.position} ·{" "}
                {s.type ?? "Shot not recorded"}
              </h4>
              <p>
                {game?.label} · vs {game?.opponent} · End {s.end} · Stone{" "}
                {s.stone}
              </p>
              <p>
                {s.execution ?? "Execution not recorded"} · Grade{" "}
                {s.grade ?? "—"}/5 · {s.deficiency ?? "Reason not recorded"}
              </p>
              <p>{s.note || "No note added."}</p>
              {(s.flagged ?? !!s.review) && (
                <p>
                  Flagged for review{s.review ? " · " + s.review : ""}
                  {s.flaggedAt
                    ? " · " + new Date(s.flaggedAt).toLocaleString()
                    : ""}
                </p>
              )}
              {link ? (
                <a href={link} target="_blank" rel="noopener noreferrer">
                  Review video from {videoTime(reviewStart(s.videoReview)!)} ↗
                </a>
              ) : (
                (s.flagged ?? !!s.review) && (
                  <p>
                    Go back {s.videoReview?.lookBackSeconds ?? 30} seconds ·
                    video timing pending
                  </p>
                )
              )}
            </article>
          );
        })}
      </section>
    </>
  );
}
