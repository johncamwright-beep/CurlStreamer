import { playerMatrices } from "./player-scorecard";
import { playerEventWindow, type EventPerformance } from "./event-performance";
import { currentShots } from "./model";
import type { CoachEvent, CoachGame } from "./event";
import { difficultyIdentity } from "./difficulty";
import { missTags } from "./report-misses";
import { missChoices, label, positiveFeedbackLabels } from "./enhanced-catalog";
import { resultLabels } from "./shot-subtypes";
import { cellText, type MatrixCell } from "./report-matrix";
import type { Evidence } from "./reports";

type Counts = { assessed: number; hits: Map<string, number> };

// Count each observation on the shot on which it was recorded. Keep separate
// assessment denominators for the standard and enhanced entry fields.
function observations(games: CoachGame[], playerId: string) {
  const counts = new Map<string, Counts>();
  function record(type: string | null, field: string, observations: string[]) {
    for (const shot of type ? [type, "All shots"] : ["All shots"]) {
      const key = shot + " · " + field;
      const row = counts.get(key) ?? {
        assessed: 0,
        hits: new Map<string, number>(),
      };
      row.assessed++;
      for (const tag of new Set(observations))
        row.hits.set(tag, (row.hits.get(tag) ?? 0) + 1);
      counts.set(key, row);
    }
  }
  for (const game of games) {
    const records = new Map(game.advancedRecords?.map((r) => [r.shotId, r]));
    for (const s of currentShots(game.state.events)) {
      if (s.excluded || s.playerId !== playerId) continue;
      if (
        s.execution &&
        s.execution !== "Make" &&
        missTags.some((tag) => tag === s.deficiency)
      ) {
        record(s.type, "Tagged miss", [s.deficiency!]);
      }
      const r = records.get(s.id);
      if (
        !game.advancedReady ||
        !r?.valid ||
        r.identity !== difficultyIdentity(s)
      )
        continue;
      const { resultObservations, misses, positiveFeedback } = r.values;
      if (
        Array.isArray(resultObservations) &&
        r.assessments.results === "assessed"
      )
        record(
          s.type,
          "Recorded result",
          resultObservations.flatMap((k) =>
            Object.hasOwn(resultLabels, k) ? [resultLabels[k]] : [],
          ),
        );
      if (Array.isArray(misses) && r.assessments.misses === "assessed")
        record(
          s.type,
          "Observed miss",
          missChoices.filter((k) => misses.includes(k)).map(label),
        );
      if (Array.isArray(positiveFeedback))
        record(
          s.type,
          "Positive feedback",
          positiveFeedback.flatMap((k) =>
            Object.hasOwn(positiveFeedbackLabels, k)
              ? [positiveFeedbackLabels[k]]
              : [],
          ),
        );
    }
  }
  return counts;
}

export function playerSectionEvidence(
  event: CoachEvent,
  playerId: string,
  data: EventPerformance,
) {
  const window = playerEventWindow(data);
  if (!window) return [];
  const matrices = playerMatrices(data, window);
  const events = new Map(
    [...(event.performanceHistory ?? []), event].map((e) => [e.id, e]),
  );
  const toText = (cell: MatrixCell) =>
    cell.value === null ? "—" : cellText(cell) + " (" + cell.sample + ")";
  const evidence: Evidence[] = [];
  for (const [index, matrix] of matrices.entries()) {
    const trend = index === 1;
    const prefix = trend ? "events" : "event";
    const periods = trend
      ? window.points.map((p) => events.get(p.id)!.games)
      : event.games.map((g) => [g]);
    const add = (
      label: string,
      values: (string | null)[],
      sample: number,
      total?: string,
    ) => {
      if (
        sample < 2 ||
        values.filter((v) => v !== null).length < (trend ? 2 : 1)
      )
        return;
      evidence.push({
        id: prefix + "-" + evidence.length,
        label,
        value:
          values
            .map((v, i) => matrix.columns[i].key + "=" + (v ?? "—"))
            .join("; ") + (total ? "; Total=" + total : ""),
        sample,
        confidence: sample < 10 ? "small" : sample < 20 ? "tentative" : "event",
      });
    };
    for (const group of matrix.groups) {
      for (const row of group.rows) {
        const sample = Number(row.total.sample?.split("/").at(-1) ?? 0);
        add(
          group.title + " · " + row.label,
          row.cells.map((c) => (c.value === null ? null : toText(c))),
          sample,
          toText(row.total),
        );
      }
    }
    const observationsByPeriod = periods.map((games) =>
      observations(games, playerId),
    );
    const keys = new Set(observationsByPeriod.flatMap((p) => [...p.keys()]));
    for (const key of keys) {
      const series = observationsByPeriod.map((p) => p.get(key));
      const tags = new Set(series.flatMap((r) => [...(r?.hits.keys() ?? [])]));
      for (const tag of tags) {
        const hits = series.reduce((n, r) => n + (r?.hits.get(tag) ?? 0), 0);
        if (hits < 2) continue;
        const assessed = series.reduce((n, r) => n + (r?.assessed ?? 0), 0);
        add(
          key + " · " + tag,
          series.map((r) =>
            r ? (r.hits.get(tag) ?? 0) + "/" + r.assessed : null,
          ),
          assessed,
          hits + "/" + assessed,
        );
      }
    }
  }
  return evidence;
}
