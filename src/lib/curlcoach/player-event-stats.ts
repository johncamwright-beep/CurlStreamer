import { difficultySummary, type DifficultyShot } from "./difficulty";
import { adjustedReportPercentage } from "./report-presentation";
import { missCounts } from "./report-misses";

export function playerEventStats(shots: DifficultyShot[]) {
  const attempts = shots.filter((s) => !s.excluded);
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
    adjusted:
      difficulty.actual === null
        ? null
        : adjustedReportPercentage(difficulty.actual, difficulty),
    ...missCounts(attempts),
  };
}
