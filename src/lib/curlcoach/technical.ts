import { lines, releases, technicals, report, type Shot } from "./model";
import type { Evidence } from "./reports";

export const technicalFields = [
  { field: "line", title: "Line", options: lines },
  { field: "release", title: "Release", options: releases },
  { field: "technical", title: "Technical", options: technicals },
] as const;

/** Each field has its own observed denominator. Missing is never a good delivery. */
export function technicalSummary(input: Shot[]) {
  const shots = input.filter((s) => !s.excluded);
  return technicalFields.map(({ field, title, options }) => {
    const recorded = shots.filter((s) => s[field] != null);
    return {
      field,
      title,
      total: shots.length,
      recorded: recorded.length,
      unrecorded: shots.length - recorded.length,
      rows: options.map((label) => {
        const subset = recorded.filter((s) => s[field] === label);
        const classified = subset.filter((s) => s.execution !== null);
        const misses = classified.filter((s) => s.execution !== "Make").length;
        const shooting = report(subset);
        return {
          label,
          count: subset.length,
          percent: recorded.length
            ? (100 * subset.length) / recorded.length
            : null,
          classified: classified.length,
          misses,
          missPercent: classified.length
            ? (100 * misses) / classified.length
            : null,
          shooting: shooting.percent,
          graded: shooting.scored,
          points: subset.reduce((n, s) => n + (s.grade ?? 0), 0),
        };
      }),
    };
  });
}
export type TechnicalSummary = ReturnType<typeof technicalSummary>;

export function technicalEvidence(
  groups: TechnicalSummary,
  prefix = "technical",
): Evidence[] {
  return groups.flatMap((g) =>
    g.recorded
      ? g.rows.flatMap((r, i) => {
          const metric = (
            suffix: string,
            label: string,
            count: number,
            total: number,
          ): Evidence => ({
            id: `${prefix}-${g.field}-${i}-${suffix}`,
            label: `${g.title} · ${r.label}: ${label}`,
            value: total
              ? `${((100 * count) / total).toFixed(1)}%`
              : "Not measured",
            sample: total,
            basis: { numerator: count, denominator: total, unit: "shots" },
            confidence:
              total < 10 ? "small" : total < 20 ? "tentative" : "event",
          });
          return [
            metric(
              "share",
              "share of recorded observations",
              r.count,
              g.recorded,
            ),
            ...(r.count
              ? [
                  metric(
                    "miss",
                    "miss rate among classified outcomes with this observation",
                    r.misses,
                    r.classified,
                  ),
                ]
              : []),
          ];
        })
      : [],
  );
}
