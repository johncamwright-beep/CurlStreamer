import { roster, type Shot } from "@/lib/curlcoach/model";
import ReviewVideo from "./ReviewVideo";

export default function ReviewSummary({
  shots,
  players = roster,
}: {
  shots: (Shot & { id: string })[];
  players?: readonly { id: string; name: string }[];
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
        return (
          <article key={shot.id} className="coach-review-item">
            <h3>
              End {shot.end} · {shot.position} · Stone {shot.stone}
            </h3>
            <p>
              {players.find((player) => player.id === shot.playerId)?.name ??
                shot.playerId}{" "}
              · {shot.type ?? "Type not recorded"}
              {shot.review ? ` · ${shot.review}` : ""}
            </p>
            <p>{shot.note || "No notes added."}</p>
            <ReviewVideo video={shot.videoReview} />
          </article>
        );
      })}
    </section>
  );
}
