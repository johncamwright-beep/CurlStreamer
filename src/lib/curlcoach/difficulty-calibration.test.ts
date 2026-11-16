import { expect, it } from "vitest";
import {
  emptySupplement,
  supplementSchema,
  type DifficultyEstimate,
} from "./enhanced-catalog";
import {
  difficultyRecords,
  difficultySummary,
  withDifficulty,
} from "./difficulty";
import { baselineMetrics } from "./event-performance";
import { changeObservation } from "./result-entry";
import { emptyState, type Shot } from "./model";
import type { AnalysisShot } from "./advanced-analysis";
import { withReportAnalysis } from "./report-analysis";
import { sampleEvent } from "./event";
import type { ReportPacket } from "./reports";
const estimate: DifficultyEstimate = {
  method: "historical-shot-type-v1",
  type: "Hit & Roll",
  referenceEvents: ["acaf5461-02b5-4ebf-9a38-cb634d734c81"],
  counts: { A: 7, B: 34, C: 4 },
};
const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Hit & Roll",
  turn: "CW C",
  execution: "Partial",
  grade: 4,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
it("uses the observed distribution continuously without inventing observed routine shots", () => {
  const s = { ...shot, difficultyEstimate: estimate };
  const result = difficultySummary([
    s,
    { ...s, excluded: "Pick" },
    { ...s, grade: null },
  ]);
  expect(result.classified).toBe(1);
  expect(result.estimated).toBe(1);
  expect(result.expected).toBeCloseTo((7 * 85 + 34 * 70 + 4 * 55) / 45);
  expect(result.mix.every((m) => m.count === 0)).toBe(true);
  const metrics = baselineMetrics(
    [s] as AnalysisShot[],
    [{ ...s, grade: 3 }] as AnalysisShot[],
  );
  expect(metrics.averageDifficulty).toBeCloseTo((7 + 68 + 12) / 45);
  expect(metrics.routineShots).toBe(0);
  expect(metrics.baselineGap).toBeNull();
  expect(metrics.estimatedShots).toBe(1);
});
it("projects only valid estimates tied to the current shot and lets observation win", () => {
  const state = emptyState();
  state.events = [
    {
      shotId: "s",
      shot,
      revision: 1,
      expectedRevision: 0,
      requestId: "r",
      actor: "coach",
      at: "2026-11-16T00:00:00Z",
    },
  ];
  const value = { ...emptySupplement(), difficultyEstimate: estimate };
  const doc = {
    at: "2026-11-16T00:00:00Z",
    kind: "supplement" as const,
    shotId: "s",
    sourceRevision: 1,
    revision: 1,
    value,
  };
  const projected = withDifficulty(
    { ...shot, id: "s" },
    difficultyRecords(state, [doc]),
    true,
  );
  expect(projected.difficulty).toBeUndefined();
  expect(projected.difficultyEstimate).toEqual(estimate);
  const event = sampleEvent("practice");
  event.games = event.games.slice(0, 1);
  event.games[0].state = state;
  event.games[0].difficultyReady = true;
  event.games[0].difficultyRecords = difficultyRecords(state, [doc]);
  const packet = {
    audience: "players",
    reports: [{ playerId: "lead", difficulty: difficultySummary([]) }],
  } as ReportPacket;
  expect(withReportAnalysis(packet, event).reports[0].difficulty).toMatchObject(
    { eligible: 1, classified: 1, estimated: 1 },
  );
  expect(packet.reports[0].difficulty?.classified).toBe(0);
  const observed = {
    ...doc,
    value: { ...value, values: { difficulty: "routine" } },
  };
  expect(
    withDifficulty(
      { ...shot, id: "s" },
      difficultyRecords(state, [observed]),
      true,
    ).difficulty,
  ).toBe("A");
  expect(
    difficultyRecords(state, [
      {
        ...doc,
        value: { ...value, difficultyEstimate: { ...estimate, type: "Draw" } },
      },
    ])[0].estimate,
  ).toBeUndefined();
  expect(
    changeObservation(value, "difficulty", "routine").difficultyEstimate,
  ).toBeUndefined();
  expect(
    changeObservation(value, "difficulty", undefined).difficultyEstimate,
  ).toBeUndefined();
  expect(
    changeObservation(value, "difficulty", "routine").values.difficulty,
  ).toBe("routine");
  expect(
    supplementSchema.safeParse({
      ...value,
      difficultyEstimate: { ...estimate, counts: { A: 0, B: 0, C: 0 } },
    }).success,
  ).toBe(false);
});
