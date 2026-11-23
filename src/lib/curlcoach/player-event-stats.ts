import {
  difficultySummary,
  easyShotIndex,
  type DifficultyShot,
} from "./difficulty";
import { report } from "./model";
import { missCounts } from "./report-misses";

// Minimums for comparing players or events. Always expose the underlying counts.
export function comparableRatings(observed: number, total: number) {
  return observed >= 10 && observed >= total * 0.7;
}

export function playerEventStats(shots: DifficultyShot[]) {
  const attempts = shots.filter((s) => !s.excluded);
  const graded = report(attempts).scored;
  const calls = attempts.filter(
    (s) => s.difficulty && !s.difficultyUnavailable,
  );
  const difficulty = difficultySummary(calls);
  const bands = difficulty.mix.map((b) => ({
    level: b.level,
    calls: calls.filter((s) => s.difficulty === b.level).length,
    graded: b.count,
    percent: b.actual,
  }));
  const ratedGraded = difficulty.classified;
  return {
    attempts: attempts.length,
    observed: calls.length,
    bands,
    ratedGraded,
    adjusted: comparableRatings(ratedGraded, graded)
      ? easyShotIndex(difficulty)
      : null,
    ...missCounts(attempts),
  };
}
