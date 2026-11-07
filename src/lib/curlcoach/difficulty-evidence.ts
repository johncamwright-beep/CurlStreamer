import {
  difficultySummary,
  difficultyDescription,
  difficultyPercent,
  difficultyPAE,
  difficultyCaveat,
  type DifficultyShot,
} from "./difficulty";
import type { Evidence } from "./reports";

/** Aggregate allowlist: never send raw shot identities or coach notes to the model. */
export function difficultyEvidence(
  shots: DifficultyShot[],
  prefix = "difficulty",
  label = "Difficulty context",
): Evidence[] {
  const s = difficultySummary(shots);
  const confidence = (n: number) =>
    n < 10
      ? ("small" as const)
      : n < 20
        ? ("tentative" as const)
        : ("event" as const);
  return [
    {
      id: prefix,
      label,
      value: `${difficultyDescription(s)} Classified subset actual ${difficultyPercent(s.actual)}, expected ${difficultyPercent(s.expected)}; reference baseline ${difficultyPercent(s.benchmarks.baseline)}. ${difficultyCaveat} Benchmark ${s.benchmarks.version}.`,
      sample: s.classified,
      confidence: confidence(s.classified),
    },
    ...s.mix.map((row) => ({
      id: `${prefix}-${row.level}`,
      label: `${label}: ${row.level}`,
      value: `${row.count} classified graded shots; ${difficultyPercent(row.share)} of the classified mix; actual ${difficultyPercent(row.actual)} versus provisional expected ${difficultyPercent(row.expected)}; above expected ${difficultyPAE(row.actual === null ? null : row.actual - row.expected)}.`,
      sample: row.count,
      confidence: confidence(row.count),
    })),
  ];
}
