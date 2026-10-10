import { deriveScore } from "@/lib/scoring";
import type { GameState } from "@/lib/types";
import { HammerIcon } from "./HammerIcon";
import type { ReactNode } from "react";

export function ScoringSummary({
  game,
  actions,
  initialHammer,
}: {
  game: GameState;
  actions?: ReactNode;
  initialHammer?: { disabled: boolean; select(side: "home" | "away"): void };
}) {
  const score = deriveScore(game);
  const endCount = Math.max(game.config.scheduledEnds, score.currentEnd);
  return (
    <section
      className="scoring-card scoring-summary"
      aria-labelledby="match-score-heading"
    >
      <div className="scoring-section-heading">
        <h2 id="match-score-heading">Match score</h2>
        <div className="flex items-center gap-2">
          <span className="scoring-badge">End {score.currentEnd}</span>
          {!score.hammer && initialHammer && (
            <span className="text-xs text-slate-300">Choose hammer ↓</span>
          )}
          {actions}
        </div>
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
          {!score.hammer && initialHammer && (
            <button
              className="scoring-initial-hammer"
              disabled={initialHammer.disabled}
              aria-label={`Give ${game.config[`${side}Name`]} hammer in End 1`}
              title="Choose starting hammer"
              onClick={() => initialHammer.select(side)}
            >
              <HammerIcon label="Choose hammer" />
            </button>
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
                    <span className="scoring-history-team">
                      {game.config[`${side}Name`]}
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
