import { standardConflicts, supplementSchema } from "./enhanced-catalog";
import type { Shot } from "./model";
import type { EnhancedDocument } from "../providers/shot-tracker-enhanced";
import { resultRelevant } from "./result-entry";

const measures = [
  ["weight", "Observed weight", "observedWeight", null],
  ["misses", "Observed misses", "misses", null],
  ["contact", "First contact", "contactResult", "contactPlan"],
  ["roll", "Roll", "rollResult", "intendedRoll"],
  ["removal", "Target removal", "removedTargets", "intendedTargets"],
] as const;

/** Coverage of included charted attempts, not success rates or unthrown stones. */
export function assessmentCoverage(
  shots: (Shot & { id: string })[],
  documents: EnhancedDocument[],
) {
  const records = new Map(
    documents.filter((d) => d.kind === "supplement").map((d) => [d.shotId, d]),
  );
  return measures.map(([group, name, key, call]) => {
    let eligible = 0,
      assessed = 0,
      unassessed = 0,
      notApplicable = 0,
      unknownCall = 0,
      needsReview = 0;
    for (const shot of shots) {
      if (shot.excluded) continue;
      const doc = records.get(shot.id);
      const parsed = doc && supplementSchema.safeParse(doc.value);
      const value = parsed?.success ? parsed.data : undefined;
      const conflicts = [
        ...(doc?.conflicts ?? []),
        ...(value ? standardConflicts(value, shot) : []),
      ];
      const sourceConflict =
        conflicts.some((c) => c.startsWith("source ")) || (!!doc && !value);
      if (call && (sourceConflict || value?.values[call] === undefined)) {
        unknownCall++;
        if (sourceConflict) needsReview++;
        continue;
      }
      if (call && !resultRelevant(value!.values, key)) {
        notApplicable++;
        continue;
      }
      eligible++;
      if (sourceConflict || conflicts.includes(group)) {
        needsReview++;
        unassessed++;
      } else if (
        value?.assessments[group] === "assessed" &&
        value.values[key] !== undefined
      )
        assessed++;
      else if (value?.assessments[group] === "not_applicable") notApplicable++;
      else unassessed++;
    }
    return {
      group,
      name,
      eligible,
      assessed,
      unassessed,
      notApplicable,
      unknownCall,
      needsReview,
    };
  });
}
