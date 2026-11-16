import { z } from "zod";
import configured from "./difficulty-benchmarks.json";
import { currentShots, type Shot, type State } from "./model";
import {
  supplementSchema,
  standardConflicts,
  type DifficultyEstimate,
} from "./enhanced-catalog";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";

export const difficultyLevels = ["A", "B", "C"] as const;
export type DifficultyLevel = (typeof difficultyLevels)[number];
export const difficultyLabels = { A: "Easy", B: "Moderate", C: "Difficult" };
export const difficultyEntryLabels = {
  routine: "A — Easy (Routine)",
  demanding: "B — Moderate (Demanding)",
  very_demanding: "C — Difficult (Very demanding)",
};
const benchmarkSchema = z.object({
  version: z.string().min(1),
  baseline: z.number().min(0).max(100),
  expected: z.object({
    A: z.number().min(0).max(100),
    B: z.number().min(0).max(100),
    C: z.number().min(0).max(100),
  }),
});
export type DifficultyBenchmarks = z.infer<typeof benchmarkSchema>;
export const difficultyBenchmarks = benchmarkSchema.parse(configured);
export const difficultyCaveat =
  "Provisional illustrative benchmarks. The easy-shot equivalent is an uncapped comparison index and can exceed 100.";
export type DifficultyShot = Shot & {
  difficultyEstimate?: DifficultyEstimate;
  difficulty?: DifficultyLevel;
  difficultyUnavailable?: boolean;
};
export type DifficultyRecord = {
  estimate?: DifficultyEstimate;
  shotId: string;
  identity: string;
  level?: DifficultyLevel;
  revision: number;
};
export const difficultyIdentity = (shot: Shot) =>
  JSON.stringify([
    shot.playerId,
    shot.position,
    shot.end,
    shot.stone,
    shot.type,
  ]);

/** Project only validated current difficulty; no notes or other private observations. */
export function difficultyRecords(
  state: State,
  documents: EnhancedDocument[],
): DifficultyRecord[] {
  const latest = new Map<string, EnhancedDocument>();
  for (const doc of documents)
    if (
      doc.kind === "supplement" &&
      doc.shotId &&
      (!latest.has(doc.shotId) ||
        latest.get(doc.shotId)!.revision < doc.revision)
    )
      latest.set(doc.shotId, doc);
  return currentShots(state.events).flatMap((shot) => {
    const doc = latest.get(shot.id);
    if (!doc) return [];
    const parsed = supplementSchema.safeParse(doc.value);
    const original = state.events.find(
      (e) => e.shotId === shot.id && e.revision === doc.sourceRevision,
    )?.shot;
    const valid =
      parsed.success &&
      original &&
      original.playerId === shot.playerId &&
      original.position === shot.position &&
      original.end === shot.end &&
      original.stone === shot.stone &&
      original.type === shot.type &&
      ![...(doc.conflicts ?? []), ...standardConflicts(parsed.data, shot)].some(
        (c) => c.startsWith("source ") || c.startsWith("difficulty"),
      );
    const code = valid ? parsed.data.values.difficulty : undefined;
    const level =
      code === "routine"
        ? "A"
        : code === "demanding"
          ? "B"
          : code === "very_demanding"
            ? "C"
            : undefined;
    return [
      {
        shotId: shot.id,
        identity: difficultyIdentity(shot),
        level,
        ...(valid &&
        !level &&
        parsed.data.difficultyEstimate?.type === shot.type
          ? { estimate: parsed.data.difficultyEstimate }
          : {}),
        revision: doc.revision,
      },
    ];
  });
}
export function withDifficulty<T extends Shot & { id: string }>(
  shot: T,
  records?: DifficultyRecord[],
  ready = false,
): T & DifficultyShot {
  const record = records?.find(
    (r) => r.shotId === shot.id && r.identity === difficultyIdentity(shot),
  );
  return {
    ...shot,
    difficulty: ready ? record?.level : undefined,
    ...(ready && !record?.level && record?.estimate
      ? { difficultyEstimate: record.estimate }
      : {}),
    difficultyUnavailable: !ready,
  };
}
/** Estimated distributions never become observed Easy/Moderate/Difficult labels. */
export function difficultyWeight(shot: DifficultyShot): number | undefined {
  if (shot.difficultyUnavailable) return undefined;
  if (shot.difficulty) return { A: 1, B: 2, C: 3 }[shot.difficulty];
  const c = shot.difficultyEstimate?.counts;
  return c ? (c.A + 2 * c.B + 3 * c.C) / (c.A + c.B + c.C) : undefined;
}
export function difficultProbability(shot: DifficultyShot): number {
  if (shot.difficulty) return shot.difficulty === "C" ? 1 : 0;
  const c = shot.difficultyEstimate?.counts;
  return c ? c.C / (c.A + c.B + c.C) : 0;
}
function expectedDifficulty(
  shot: DifficultyShot,
  config: DifficultyBenchmarks,
) {
  if (shot.difficulty) return config.expected[shot.difficulty];
  const c = shot.difficultyEstimate!.counts;
  return (
    (c.A * config.expected.A +
      c.B * config.expected.B +
      c.C * config.expected.C) /
    (c.A + c.B + c.C)
  );
}
/** Aggregate points, never averages of game/player percentages. Round only for display. */
export function difficultySummary(
  shots: DifficultyShot[],
  config: DifficultyBenchmarks = difficultyBenchmarks,
) {
  const benchmarks = benchmarkSchema.parse(config);
  const eligible = shots.filter(
    (s) =>
      !s.excluded &&
      s.grade !== null &&
      Number.isFinite(s.grade) &&
      s.grade >= 0 &&
      s.grade <= 5,
  );
  const classified = eligible.filter(
    (s) => !s.difficultyUnavailable && difficultyWeight(s) !== undefined,
  );
  const n = classified.length;
  const actualPoints = classified.reduce((sum, s) => sum + s.grade!, 0);
  const expectedPoints = classified.reduce(
    (sum, s) => sum + (5 * expectedDifficulty(s, benchmarks)) / 100,
    0,
  );
  const pae = n ? ((actualPoints - expectedPoints) / (5 * n)) * 100 : null;
  return {
    benchmarks,
    eligible: eligible.length,
    classified: n,
    ...(classified.some((s) => !s.difficulty && s.difficultyEstimate)
      ? {
          estimated: classified.filter(
            (s) => !s.difficulty && s.difficultyEstimate,
          ).length,
        }
      : {}),
    unavailable: eligible.filter((s) => s.difficultyUnavailable).length,
    coverage: eligible.length ? (n / eligible.length) * 100 : null,
    actual: n ? (actualPoints / (5 * n)) * 100 : null,
    expected: n ? (expectedPoints / (5 * n)) * 100 : null,
    pae,
    adjusted: pae === null ? null : benchmarks.baseline + pae,
    mix: difficultyLevels.map((level) => {
      const rows = classified.filter((s) => s.difficulty === level);
      return {
        level,
        count: rows.length,
        share: n ? (rows.length / n) * 100 : null,
        actual: rows.length
          ? (rows.reduce((sum, s) => sum + s.grade!, 0) / (5 * rows.length)) *
            100
          : null,
        expected: benchmarks.expected[level],
      };
    }),
  };
}
export type DifficultySummary = ReturnType<typeof difficultySummary>;
export function easyShotIndex(s: DifficultySummary) {
  // Apply the easy reference to old saved snapshots as well as current scores.
  return s.pae === null ? null : s.benchmarks.expected.A + s.pae;
}
export function formatEasyShotIndex(s: DifficultySummary) {
  const value = easyShotIndex(s);
  return value === null
    ? "N/A"
    : (Math.abs(value) < 0.05 ? 0 : value).toFixed(1);
}
export const difficultyPercent = (n: number | null) =>
  n === null ? "N/A" : `${(Math.abs(n) < 0.05 ? 0 : n).toFixed(1)}%`;
export const difficultyPAE = (n: number | null) =>
  n === null
    ? "N/A"
    : `${n >= 0 ? "+" : ""}${(Math.abs(n) < 0.05 ? 0 : n).toFixed(1)} pp`;
export function difficultyDescription(s: DifficultySummary) {
  return `Easy-shot equivalent: ${formatEasyShotIndex(s)} · Above expected: ${difficultyPAE(s.pae)}. Coverage: ${s.classified} of ${s.eligible} eligible graded shots (${difficultyPercent(s.coverage)}).${s.classified < s.eligible ? " Classified subset only; traditional shooting includes all eligible graded shots." : ""}${s.unavailable ? " Some difficulty data is unavailable; refresh to retry." : ""}${s.classified > 0 && s.classified < 10 ? " Small sample." : s.classified > 0 && s.classified < 20 ? " Tentative sample." : ""}`;
}
