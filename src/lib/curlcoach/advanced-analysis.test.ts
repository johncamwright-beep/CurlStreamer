import { expect, it } from "vitest";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";
import {
  analysisCoverage,
  analysisEventShots,
  analysisRecords,
} from "./advanced-analysis";
import { defaultShotFilters, filterAnalysisShots } from "./analysis";
import { emptySupplement } from "./enhanced-catalog";
import { sampleEvent } from "./event";
import { append, currentShots, emptyState, report, type Shot } from "./model";

const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 0,
  deficiency: "Light",
  review: null,
  excluded: null,
  note: "",
};
function fixture() {
  const event = sampleEvent("practice");
  const game = event.games[0];
  const id = crypto.randomUUID();
  game.state = append(
    emptyState(),
    { requestId: crypto.randomUUID(), expectedRevision: 0, shotId: id, shot },
    "coach",
  );
  const value = emptySupplement();
  value.values = {
    shotSubtype: "straight_draw",
    intendedWeight: "button",
    observedDestination: "top_8",
    resultObservations: ["light"],
    instruction: "PRIVATE INSTRUCTION",
    conditionsNote: "PRIVATE NOTE",
  };
  value.assessments = { destination: "assessed", results: "assessed" };
  const doc: EnhancedDocument = {
    kind: "supplement",
    shotId: id,
    revision: 1,
    sourceRevision: 1,
    at: "now",
    value,
  };
  const project = (documents = [doc]) => {
    game.analysisRecords = analysisRecords(game.state, documents);
    game.analysisReady = true;
    return analysisEventShots(event);
  };
  const change = (next: Shot | null) => {
    game.state = append(
      game.state,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: game.state.revision!,
        shotId: id,
        shot: next,
      },
      "coach",
    );
  };
  return { event, game, value, doc, project, change };
}

it("projects only the allowlist from the latest supplement revision, independent of input order", () => {
  const f = fixture();
  const older = structuredClone(f.doc);
  f.doc.revision = 3;
  f.value.values.intendedWeight = "top_4";
  const rows = f.project([f.doc, { ...older, kind: "context" }, older]);
  expect(rows[0]).toMatchObject({
    shotSubtype: "straight_draw",
    intendedWeight: "top_4",
    observedDestination: "top_8",
    resultObservations: ["light"],
  });
  expect(JSON.stringify(f.game.analysisRecords)).not.toMatch(
    /PRIVATE|instruction|conditionsNote|contextSnapshot|assessments|values/,
  );
  const filtered = filterAnalysisShots(rows, [f.game], defaultShotFilters);
  expect(filtered[0].resultObservations).toEqual(["light"]);
  rows[0].resultObservations!.push("heavy");
  expect(analysisEventShots(f.event)[0].resultObservations).toEqual(["light"]);
});

it("does not resurrect older values after a later clear or invalid revision", () => {
  const f = fixture();
  const older = structuredClone(f.doc);
  f.doc.revision = 2;
  f.value.values = {};
  f.value.assessments = {};
  expect(f.project([older, f.doc])[0]).toMatchObject({
    shotSubtype: null,
    resultObservations: null,
    analysisStatus: "available",
  });
  f.doc.value = { invalid: true };
  expect(f.project([older, f.doc])[0]).toMatchObject({
    intendedWeight: null,
    analysisStatus: "invalid",
  });
});

it.each([
  { playerId: "other" },
  { position: "Second" as const },
  { end: 2 },
  { stone: 2 },
  { type: "Come Around" as const },
])(
  "invalidates source identity changes %j including records cached before refresh",
  (patch) => {
    const f = fixture();
    f.project();
    f.change({ ...shot, ...patch });
    expect(analysisEventShots(f.event)[0]).toMatchObject({
      shotSubtype: null,
      analysisStatus: "conflicted",
      resultAssessment: "conflicted",
    });
    expect(f.project()[0]).toMatchObject({
      analysisStatus: "conflicted",
      intendedWeight: null,
      observedDestination: null,
      resultObservations: null,
    });
  },
);

it("preserves observations through grade corrections, deletion and append-only restoration", () => {
  const f = fixture();
  f.change({ ...shot, grade: 5 });
  expect(f.project()[0].shotSubtype).toBe("straight_draw");
  f.change(null);
  expect(f.project()).toEqual([]);
  f.change(shot);
  expect(f.project()[0].resultObservations).toEqual(["light"]);
});

it("blocks only conflicted groups and blocks all observations for source conflicts", () => {
  const f = fixture();
  f.doc.conflicts = ["results", "technical"];
  expect(f.project()[0]).toMatchObject({
    resultAssessment: "conflicted",
    resultObservations: null,
    observedDestination: "top_8",
    intendedWeight: "button",
    shotSubtype: "straight_draw",
  });
  f.doc.conflicts = ["destination"];
  expect(f.project()[0]).toMatchObject({
    destinationAssessment: "conflicted",
    observedDestination: null,
    resultObservations: ["light"],
  });
  f.doc.conflicts = ["source identity requires reconciliation"];
  expect(f.project()[0]).toMatchObject({
    resultObservations: null,
    intendedWeight: null,
  });
});

it("distinguishes explicitly assessed no miss from missing and not-applicable observations", () => {
  const f = fixture();
  f.value.values.resultObservations = [];
  expect(analysisCoverage(f.project())).toMatchObject({
    resultsAssessed: 1,
    noObservedMiss: 1,
  });
  delete f.value.values.resultObservations;
  delete f.value.assessments.results;
  expect(f.project()[0]).toMatchObject({
    resultObservations: null,
    resultAssessment: "not_assessed",
  });
  expect(analysisCoverage(f.project()).noObservedMiss).toBe(0);
  f.value.assessments.results = "not_applicable";
  expect(f.project()[0].resultAssessment).toBe("not_applicable");
  expect(f.project([])[0].analysisStatus).toBe("missing");
});

it("retains zero grades, omits excluded shots from coverage, and preserves standard data on read failure", () => {
  const f = fixture();
  expect(analysisCoverage(f.project())).toMatchObject({
    eligible: 1,
    resultsAssessed: 1,
  });
  expect(report(f.project()).percent).toBe(0);
  f.change({ ...shot, excluded: "Pick", grade: null });
  expect(analysisCoverage(f.project())).toMatchObject({
    eligible: 0,
    subtyped: 0,
    resultsAssessed: 0,
  });
  f.change(shot);
  const before = currentShots(f.game.state.events);
  f.game.analysisReady = false;
  expect(analysisEventShots(f.event)[0]).toMatchObject({
    grade: 0,
    type: "Draw",
    analysisUnavailable: true,
    resultAssessment: "unavailable",
  });
  expect(currentShots(f.game.state.events)).toEqual(before);
});
