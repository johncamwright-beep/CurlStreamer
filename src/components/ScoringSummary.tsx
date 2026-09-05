import { deriveScore } from "@/lib/scoring";
import type { GameState } from "@/lib/types";
import { HammerIcon } from "./HammerIcon";

export function ScoringSummary({ game }: { game: GameState }) {
  const score = deriveScore(game);
  const endCount = Math.max(game.config.scheduledEnds, score.currentEnd);
  return (
    <section
      className="scoring-card scoring-summary"
      aria-labelledby="match-score-heading"
    >
      <div className="scoring-section-heading">
        <h2 id="match-score-heading">Match score</h2>
        <span className="scoring-badge">End {score.currentEnd}</span>
      </div>
      {(["home", "away"] as const).map((side) => (
        <div className="scoring-team-row" key={side}>
          <span
            className="scoring-rock"
            style={{ backgroundColor: game.config[`${side}Color`] }}
            aria-hidden="true"
          />
          <span className="scoring-team-name">
            {game.config[`${side}Name`]}
          </span>
          {score.hammer === side && (
            <HammerIcon
              label={`${game.config[`${side}Name`]}: Last stone advantage (Hammer)`}
            />
          )}
          <strong
            className="scoring-total"
            aria-label={`${game.config[`${side}Name`]} total: ${score.totals[side]}`}
          >
            {score.totals[side]}
          </strong>
        </div>
      ))}
      <details className="scoring-history-details">
        <summary>End-by-end score</summary>
        <div
          className="scoring-history"
          role="region"
          aria-label="Score by end, scroll for more ends"
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">Score by end</caption>
            <thead>
              <tr>
                <th scope="col">End</th>
                {Array.from({ length: endCount }, (_, i) => (
                  <th scope="col" key={i}>
                    {i + 1}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(["home", "away"] as const).map((side) => (
                <tr key={side}>
                  <th scope="row">
                    <span className="sr-only">
                      {game.config[`${side}Name`]}
                    </span>
                    <span aria-hidden="true">
                      {side === "home" ? "Home" : "Away"}
                    </span>
                  </th>
                  {Array.from({ length: endCount }, (_, i) => {
                    const end = score.ends.find((value) => value.end === i + 1);
                    return (
                      <td key={i}>
                        {end ? (end.team === side ? end.points : 0) : "–"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
