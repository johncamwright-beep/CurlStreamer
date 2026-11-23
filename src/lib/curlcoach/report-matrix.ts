import type {
  PerformanceMeasure,
  PlayerPeriodStats,
} from "./event-performance";
import { difficultyLabels } from "./difficulty";
import { shotTypes, turns } from "./model";
import { missTags } from "./report-misses";
import { technicalFields } from "./technical";

export type MatrixCell = { value: number | null; sample?: string };
type Row = {
  label: string;
  cells: MatrixCell[];
  total: MatrixCell;
  better: "higher" | "lower" | "neutral";
};
export type ReportMatrix = {
  kind: "matrix";
  title: "Event Stats" | "Trends";
  columns: { key: string; name: string }[];
  groups: { title: string; rows: Row[] }[];
};
export function matrixChange(row: Row) {
  const first = row.cells[0]?.value,
    last = row.cells.at(-1)?.value;
  if (row.cells.length < 2 || first == null || last == null)
    return { text: "—", color: "#526574" };
  const delta = Number((last - first).toFixed(1));
  const direction =
    row.better === "lower" ? -delta : row.better === "higher" ? delta : 0;
  return {
    text: `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`,
    color: direction > 0 ? "#167144" : direction < 0 ? "#AE352E" : "#526574",
  };
}

// Normalized coordinates shared by the PDF and inline sparklines. Null breaks the line.
export function matrixPoints(row: Row) {
  const max = Math.max(100, ...row.cells.map((c) => c.value ?? 0));
  return row.cells.map((cell, i) =>
    cell.value === null
      ? null
      : {
          x: row.cells.length === 1 ? 0.5 : i / (row.cells.length - 1),
          y: 1 - cell.value / max,
        },
  );
}
export const cellText = (cell: MatrixCell) =>
  cell.value === null ? "—" : cell.value.toFixed(1) + "%";

type Period = { key: string; name: string; stats: PlayerPeriodStats };
export function matrixScope(matrix: ReportMatrix) {
  const count = matrix.columns.length;
  return matrix.title === "Event Stats"
    ? `${count} game${count === 1 ? "" : "s"}`
    : `${count > 1 ? "Last " : ""}${count} event${count === 1 ? "" : "s"}`;
}
export function matrixEndpoints(matrix: ReportMatrix) {
  return matrix.columns.length > 1
    ? `${matrix.columns.at(-1)!.key} vs ${matrix.columns[0].key}`
    : "";
}
const missing: MatrixCell = { value: null };
function shooting(m?: PerformanceMeasure): MatrixCell {
  return m?.percent == null
    ? missing
    : { value: m.percent, sample: String(m.graded) };
}
function share(count: number, total: number): MatrixCell {
  return total
    ? { value: (100 * count) / total, sample: `${count}/${total}` }
    : missing;
}

export function reportMatrix(
  title: ReportMatrix["title"],
  periods: Period[],
  pooled: PlayerPeriodStats | undefined,
): ReportMatrix {
  const row = (
    label: string,
    get: (s: PlayerPeriodStats) => MatrixCell,
    better: Row["better"] = "higher",
  ): Row => ({
    label,
    cells: periods.map((p) => get(p.stats)),
    total: pooled ? get(pooled) : missing,
    better,
  });
  const groups: ReportMatrix["groups"] = [];
  function group(title: string, rows: Row[]) {
    if (rows.length) groups.push({ title, rows });
  }
  group("Shooting", [
    row("Overall", (s) => shooting(s.shooting)),
    row("Difficulty-adjusted", (s) =>
      s.adjusted == null
        ? missing
        : { value: s.adjusted, sample: String(s.ratedGraded) },
    ),
  ]);
  group(
    "Shot performance",
    shotTypes
      .filter((t) => periods.some((p) => p.stats.byType[t]?.graded))
      .map((t) => row(t, (s) => shooting(s.byType[t]))),
  );
  const levels = ["A", "B", "C"] as const;
  group("Shot difficulty · share of rated calls", [
    row("Calls rated", (s) => share(s.observed, s.attempts), "neutral"),
    row(
      "Moderate or difficult",
      (s) =>
        share(
          s.bands.reduce((n, b) => n + (b.level === "A" ? 0 : b.calls), 0),
          s.observed,
        ),
      "neutral",
    ),
    ...levels.map((level) =>
      row(
        difficultyLabels[level],
        (s) => {
          const band = s.bands.find((b) => b.level === level);
          return band ? share(band.calls, s.observed) : missing;
        },
        "neutral",
      ),
    ),
  ]);
  group(
    "Shooting by difficulty",
    levels
      .filter((level) =>
        periods.some((p) =>
          p.stats.bands.some((b) => b.level === level && b.graded),
        ),
      )
      .map((level) =>
        row(difficultyLabels[level], (s) =>
          shooting(s.bands.find((b) => b.level === level)),
        ),
      ),
  );
  group(
    "Performance by turn",
    turns
      .filter((t) => periods.some((p) => p.stats.byTurn[t]?.graded))
      .map((t) => row(t, (s) => shooting(s.byTurn[t]))),
  );
  group("Miss patterns · per recorded outcome", [
    row(
      "Partial / limited / miss",
      (s) => share(s.misses, s.classified),
      "lower",
    ),
    row("Complete miss", (s) => share(s.fullMisses, s.classified), "lower"),
    ...missTags
      .filter((tag) =>
        periods.some((p) =>
          p.stats.categories.some((c) => c.tag === tag && c.count),
        ),
      )
      .map((tag) =>
        row(
          tag,
          (s) =>
            s.misses && !s.tagged
              ? missing
              : share(
                  s.categories.find((c) => c.tag === tag)?.count ?? 0,
                  s.classified,
                ),
          "lower",
        ),
      ),
    ...(periods.some((p) => p.stats.misses > p.stats.tagged)
      ? [
          row(
            "Untagged",
            (s) => share(s.misses - s.tagged, s.classified),
            "neutral",
          ),
        ]
      : []),
  ]);
  for (const field of technicalFields) {
    const observation = (s: PlayerPeriodStats) =>
      s.technical.find((g) => g.title === field.title);
    const labels = field.options.filter((label) =>
      periods.some((p) =>
        observation(p.stats)?.rows.some((r) => r.label === label),
      ),
    );
    group(
      "Technical observations · " + field.title,
      labels.map((label) =>
        row(
          label,
          (s) => {
            const g = observation(s);
            return g
              ? share(
                  g.rows.find((r) => r.label === label)?.count ?? 0,
                  g.recorded,
                )
              : missing;
          },
          "neutral",
        ),
      ),
    );
    const gradedLabels = labels.filter((label) =>
      periods.some((p) =>
        observation(p.stats)?.rows.some((r) => r.label === label && r.graded),
      ),
    );
    group(
      "Shooting by observation · " + field.title,
      gradedLabels.map((label) =>
        row(label, (s) =>
          shooting(observation(s)?.rows.find((r) => r.label === label)),
        ),
      ),
    );
  }
  return {
    kind: "matrix",
    title,
    columns: periods.map(({ key, name }) => ({ key, name })),
    groups,
  };
}
