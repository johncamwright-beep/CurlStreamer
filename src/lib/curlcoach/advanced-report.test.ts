import { describe, it, expect } from "vitest";
import {
  advancedRecords,
  advancedReport,
  advancedEvidence,
} from "./advanced-report";
import { emptySupplement, supplementSchema } from "./enhanced-catalog";
import { append, emptyState, currentShots, type Shot } from "./model";
import { sampleEvent } from "./event";
import { reportInputs, REPORT_INSTRUCTIONS } from "./reports";
import { reportSections } from "./report-presentation";
import { shotSubtypes } from "./shot-subtypes";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";

const base: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Guard/Front Stone",
  turn: "CW C",
  execution: "Make",
  grade: 5,
  deficiency: null,
  excluded: null,
  review: null,
  note: "PRIVATE NOTE",
};
function fixture() {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 1);
  const game = event.games[0];
  game.state = emptyState();
  game.status = "completed";
  const docs: EnhancedDocument[] = [];
  const add = (
    values: ReturnType<typeof emptySupplement>["values"],
    assessments: ReturnType<typeof emptySupplement>["assessments"] = {},
    overrides: Partial<Shot> = {},
  ) => {
    const shotId = crypto.randomUUID();
    game.state = append(
      game.state,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: game.state.revision!,
        shotId,
        shot: { ...base, stone: game.state.events.length + 1, ...overrides },
      },
      "coach",
    );
    const value = { ...emptySupplement(), values, assessments };
    supplementSchema.parse(value);
    docs.push({
      kind: "supplement",
      shotId,
      revision: 1,
      sourceRevision: game.state.revision!,
      at: "now",
      value,
    });
    return shotId;
  };
  const refresh = () => {
    game.advancedRecords = advancedRecords(game.state, docs);
    game.advancedReady = true;
    return advancedReport(event);
  };
  return { event, game, docs, add, refresh };
}
const metrics = (s: ReturnType<typeof advancedReport>) =>
  s.groups.flatMap((g) => g.metrics);
describe("advanced report evidence", () => {
  it("uses assessed denominators, explicit no miss, overlap, zeros and excludes excluded shots", () => {
    const f = fixture();
    const subtype = shotSubtypes.find((s) => s.standard === base.type)!.id;
    f.add(
      {
        shotSubtype: subtype,
        intendedWeight: "1_guard",
        observedDestination: "2_guard",
        resultObservations: ["heavy", "in_house"],
      },
      { destination: "assessed", results: "assessed" },
      { grade: 0, execution: "Xmiss" },
    );
    f.add(
      {
        shotSubtype: subtype,
        intendedWeight: "1_guard",
        observedDestination: "1_guard",
        resultObservations: [],
      },
      { destination: "assessed", results: "assessed" },
    );
    f.add({ shotSubtype: subtype }, {}, { grade: null });
    f.add(
      { shotSubtype: subtype, resultObservations: ["heavy"] },
      { results: "assessed" },
      { excluded: "Pick" },
    );
    const summary = f.refresh(),
      rows = metrics(summary);
    expect(summary.included).toBe(3);
    expect(
      rows.find((r) => r.id === `advanced-subtype-${subtype}`)?.basis,
    ).toEqual({ numerator: 5, denominator: 10, unit: "points", shots: 2 });
    for (const suffix of [
      "resultObservations-heavy",
      "resultObservations-in_house",
      "resultObservations-none",
      "weight-1_guard-2_guard",
    ])
      expect(rows.find((r) => r.id === `advanced-${suffix}`)?.basis).toEqual({
        numerator: 1,
        denominator: 2,
        unit: "shots",
      });
    expect(
      rows.find((r) => r.id === "advanced-coverage-resultObservations")?.basis
        ?.numerator,
    ).toBe(2);
    expect(
      rows.find((r) => r.id === "advanced-coverage-resultObservations")?.basis
        ?.denominator,
    ).toBe(3);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows.every((r) => r.id.length <= 100)).toBe(true);
    expect(advancedEvidence(summary, 4)).toHaveLength(4);
  });
  it("takes latest clearing, preserves advanced data on grade correction and rejects moved identities", () => {
    const f = fixture();
    const id = f.add(
      { resultObservations: ["heavy"] },
      { results: "assessed" },
    );
    f.docs.push({ ...f.docs[0], revision: 2, value: emptySupplement() });
    expect(
      metrics(f.refresh()).some(
        (r) => r.id === "advanced-resultObservations-heavy",
      ),
    ).toBe(false);
    f.docs.pop();
    const change = (patch: Partial<Shot>) => {
      const shot = currentShots(f.game.state.events)[0];
      f.game.state = append(
        f.game.state,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: f.game.state.revision!,
          shotId: id,
          shot: { ...shot, ...patch },
        },
        "coach",
      );
    };
    change({ grade: 1 });
    expect(f.refresh().recorded).toBe(1);
    change({ playerId: "other" });
    expect(f.refresh().needsReview).toBe(1);
    expect(f.refresh().recorded).toBe(0);
  });
  it("omits private fields and conflicted groups, and exposes missing source data honestly", () => {
    const f = fixture();
    f.add({ resultObservations: ["heavy"] }, { results: "assessed" });
    f.docs[0].conflicts = ["results"];
    expect(f.refresh().needsReview).toBe(1);
    expect(
      metrics(f.refresh()).some(
        (r) => r.id === "advanced-resultObservations-heavy",
      ),
    ).toBe(false);
    f.docs[0].conflicts = ["resultObservations requires reconciliation"];
    expect(
      metrics(f.refresh()).some(
        (r) => r.id === "advanced-resultObservations-heavy",
      ),
    ).toBe(false);
    expect(JSON.stringify(f.game.advancedRecords)).not.toContain(
      "PRIVATE NOTE",
    );
    f.game.advancedReady = false;
    expect(advancedReport(f.event).unavailable).toBe(1);
    expect(advancedReport(f.event).recorded).toBe(0);
  });
  it("never infers contact or removal opportunities from grade or shot type", () => {
    const f = fixture();
    f.add({}, {}, { type: "Hit & Stay" });
    f.add(
      { intendedTargets: 2, removedTargets: 1 },
      { removal: "assessed" },
      { type: "Hit & Stay" },
    );
    const rows = metrics(f.refresh());
    expect(
      rows.find((r) => r.id === "advanced-removal-complete")?.basis,
    ).toEqual({ numerator: 0, denominator: 1, unit: "shots" });
    expect(rows.some((r) => r.id === "advanced-coverage-contactResult")).toBe(
      false,
    );
  });
  it("includes advanced evidence for every audience with player isolation and game-scoped references", () => {
    const f = fixture();
    f.add({ resultObservations: ["heavy"] }, { results: "assessed" });
    f.add(
      { resultObservations: ["light"] },
      { results: "assessed" },
      { playerId: "second", position: "Second" },
    );
    f.game.state.roster = [
      { id: "lead", name: "PRIVATE LEAD", position: "Lead" },
      { id: "second", name: "PRIVATE SECOND", position: "Second" },
    ];
    f.refresh();
    const player = reportInputs(f.event, "players")[0];
    expect(
      player.evidence.some((e) => e.id === "advanced-resultObservations-heavy"),
    ).toBe(true);
    expect(
      player.evidence.some((e) => e.id === "advanced-resultObservations-light"),
    ).toBe(false);
    expect(
      player.evidence.some(
        (e) => e.id === "game-1-advanced-resultObservations-heavy",
      ),
    ).toBe(true);
    for (const audience of ["team", "coach"] as const) {
      const input = reportInputs(f.event, audience)[0];
      expect(
        input.evidence.some(
          (e) => e.id === "advanced-resultObservations-heavy",
        ),
      ).toBe(true);
      expect(input.advanced?.recorded).toBe(2);
      expect(JSON.stringify(input.evidence)).not.toContain("PRIVATE");
    }
    expect(REPORT_INSTRUCTIONS).toContain("categorical distributions");
    expect(REPORT_INSTRUCTIONS).toContain("not causal explanations");
    const finding = {
      text: "Rehearse the supported weight pattern",
      evidence: ["advanced-resultObservations-heavy"],
    };
    const sections = reportSections({
      ...player,
      narrative: {
        summary: finding,
        strengths: [finding],
        priorities: [finding],
        practice: [finding],
        review: [finding],
      },
    });
    expect(
      sections.find((s) => s.title === "Next practice")?.findings[0].text,
    ).toBe(finding.text);
  });
});
