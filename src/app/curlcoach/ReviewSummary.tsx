import { roster, type Shot } from "@/lib/curlcoach/model";
import { reviewLink, reviewStart, videoTime } from "@/lib/curlcoach/review";

export default function ReviewSummary({
  shots,
}: {
  shots: (Shot & { id: string })[];
}) {
  const flagged = shots
    .filter((shot) => shot.flagged ?? !!shot.review)
    .sort(
      (a, b) =>
        a.end - b.end ||
        ["Lead", "Second", "Third", "Fourth"].indexOf(a.position) -
          ["Lead", "Second", "Third", "Fourth"].indexOf(b.position) ||
        a.stone - b.stone,
    );
  return (
    <section
      className="event-card coach-review-summary"
      aria-label="Game review summary"
    >
      <h2>Game review summary · {flagged.length} flagged shots</h2>
      {!flagged.length && (
        <p>Flag shots while scoring to build your game review list.</p>
      )}
      {flagged.map((shot) => {
        const link = reviewLink(shot.videoReview);
        return (
          <article key={shot.id} className="coach-review-item">
            <h3>
              End {shot.end} · {shot.position} · Stone {shot.stone}
            </h3>
            <p>
              {roster.find((player) => player.id === shot.playerId)?.name} ·{" "}
              {shot.type ?? "Type not recorded"}
              {shot.review ? ` · ${shot.review}` : ""}
            </p>
            <p>{shot.note || "No notes added."}</p>
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer">
                Review video from {videoTime(reviewStart(shot.videoReview)!)} ↗
              </a>
            ) : (
              <p>
                Video synchronization pending.{" "}
                {shot.flaggedAt
                  ? `Flag captured ${new Date(shot.flaggedAt).toLocaleString()}.`
                  : "This older flag has no captured real-time timestamp."}{" "}
                Go back {shot.videoReview?.lookBackSeconds ?? 30} seconds.
              </p>
            )}
          </article>
        );
      })}
    </section>
  );
}
