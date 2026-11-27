import type {
  PerformanceMeasure,
  PlayerPeriodStats,
} from "./event-performance";
import { difficultyLabels } from "./difficulty";
import { executions, shotTypes, turns } from "./model";
import {
  outcomeLabel,
  rankedMissReasons,
  recurringMissPairs,
} from "./report-misses";
import { technicalFields } from "./technical";
import { rankAnalysis } from "./ranking";

export type MatrixCell = { value: number | null; sample?: string };
type Row = {
  label: string;
  cells: MatrixCell[];
  total: MatrixCell;
  better: "higher" | "lower" | "neutral";
};
export type ReportMatrix = {
  kind: "matrix";
  title: "Event Stats" | "Trends over time (by event)";
  narrative?: string;
  columns: { key: string; name: string }[];
  groups: { title: string; rows: Row[]; metric: "shooting" | "share" }[];
};
type Metric = ReportMatrix["groups"][number]["metric"];

export function totalCellFill(metric: Metric, cell: MatrixCell) {
  if (metric !== "shooting" || cell.value === null) return "#DCEFF9";
  const percent = Number(cell.value.toFixed(1));
  if (percent <= 50) return "#EC9DA9";
  if (percent <= 60) return "#F6C4C2";
  if (percent < 70) return "#F8CCA2";
  if (percent < 80) return "#F6E3A2";
  if (percent < 85) return "#D5E8B5";
  return "#94D5AB";
}
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

// Keep the original period spacing and draw only observed values.
export function matrixPoints(row: Row) {
  const max = Math.max(100, ...row.cells.map((c) => c.value ?? 0));
  return row.cells.flatMap((cell, i) =>
    cell.value === null
      ? []
      : [
          {
            x: row.cells.length === 1 ? 0.5 : i / (row.cells.length - 1),
            y: 1 - cell.value / max,
          },
        ],
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
  function group(title: string, metric: Metric, rows: Row[]) {
    if (rows.length)
      groups.push({
        title,
        metric,
        rows: rankAnalysis(
          rows,
          "descending",
          (r) => r.total.value,
          (r) => r.label,
        ),
      });
  }
  group("Shooting", "shooting", [
    row("Overall", (s) => shooting(s.shooting)),
    row("Difficulty-adjusted", (s) =>
      s.adjusted == null
        ? missing
        : { value: s.adjusted, sample: String(s.ratedGraded) },
    ),
  ]);
  group(
    "Shot performance",
    "shooting",
    shotTypes
      .filter((t) => periods.some((p) => p.stats.byType[t]?.graded))
      .map((t) => row(t, (s) => shooting(s.byType[t]))),
  );
  const levels = ["A", "B", "C"] as const;
  group("Shot difficulty · share of rated calls", "share", [
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
    "shooting",
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
    "shooting",
    turns
      .filter((t) => periods.some((p) => p.stats.byTurn[t]?.graded))
      .map((t) => row(t, (s) => shooting(s.byTurn[t]))),
  );
  group(
    "Shot outcomes · share of recorded outcomes",
    "share",
    executions.map((execution) =>
      row(
        outcomeLabel(execution),
        (s) =>
          s.outcomes ? share(s.outcomes[execution], s.classified) : missing,
        execution === "Make"
          ? "higher"
          : execution === "Xmiss"
            ? "lower"
            : "neutral",
      ),
    ),
  );
  group(
    "Miss reasons · share of tagged shots",
    "share",
    rankedMissReasons(pooled?.reasons?.counts ?? {}).map(([tag]) =>
      row(
        tag,
        (s) =>
          s.reasons
            ? share(s.reasons.counts[tag] ?? 0, s.reasons.tagged)
            : missing,
        "neutral",
      ),
    ),
  );
  group(
    "Recurring misses by shot · share of tagged shots of that type",
    "share",
    recurringMissPairs(pooled?.missPatternsByShot ?? {}).map(({ type, tag }) =>
      row(
        type + " · " + tag,
        (s) => {
          const group = s.missPatternsByShot?.[type];
          return group ? share(group.counts[tag] ?? 0, group.tagged) : missing;
        },
        "neutral",
      ),
    ),
  );
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
      "share",
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
      "shooting",
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
