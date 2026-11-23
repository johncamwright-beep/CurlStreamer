import { expect, it } from "vitest";
import {
  baselineMetrics,
  eventPerformance,
  reportEventPerformance,
  performanceEvidence,
} from "./event-performance";
import type { AnalysisShot } from "./advanced-analysis";
import { sampleEvent } from "./event";
import { append, emptyState, type Shot } from "./model";
import { difficultyIdentity } from "./difficulty";
import { reportInputs } from "./reports";
import { selectPromptEvidence } from "../providers/shot-tracker-ai";
import { playerEventStats } from "./player-event-stats";
import {
  playerScorecard,
  playerScorecardBlocks,
  playerScorecardCards,
} from "./player-scorecard";
import type { SavedReport } from "./reports";

const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 4,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
const s = (
  grade: number | null,
  difficulty: AnalysisShot["difficulty"] = "A",
  playerId = "lead",
  subtype: string | null = "straight_draw",
) =>
  ({
    ...shot,
    grade,
    difficulty,
    playerId,
    shotSubtype: subtype,
  }) as AnalysisShot;
const copies = (n: number, value: AnalysisShot) =>
  Array.from({ length: n }, () => ({ ...value }));
function event(id: string, date: string, shots: AnalysisShot[]) {
  const e = sampleEvent("practice");
  e.id = id;
  e.name = id;
  e.startDate = date;
  e.seasonId = "season";
  e.games = [e.games[0]];
  const g = e.games[0];
  g.id = id;
  g.eventId = id;
  g.status = "completed";
  g.scheduledStart = date;
  g.state = emptyState();
  g.difficultyReady = true;
  g.analysisReady = true;
  g.difficultyRecords = [];
  g.analysisRecords = [];
  shots.forEach((value, i) => {
    const clean: Shot = {
      ...shot,
      end: i + 1,
      grade: value.grade,
      playerId: value.playerId,
      excluded: value.excluded,
    };
    const shotId = crypto.randomUUID();
    g.state = append(
      g.state,
      {
        shotId,
        shot: clean,
        expectedRevision: i,
        requestId: crypto.randomUUID(),
      },
      "coach",
    );
    g.difficultyRecords!.push({
      shotId,
      identity: difficultyIdentity(clean),
      level: value.difficulty,
      revision: 1,
    });
    g.analysisRecords!.push({
      shotId,
      identity: difficultyIdentity(clean),
      revision: 1,
      shotSubtype: value.shotSubtype,
      intendedWeight: null,
      observedDestination: null,
      resultObservations: null,
      destinationAssessment: "not_assessed",
      resultAssessment: "not_assessed",
      analysisStatus: "available",
    });
  });
  return e;
}
it("uses one easy-shot scale for players and keeps estimates outside observed difficulty", () => {
  const easy = [...copies(15, s(4)), ...copies(5, s(5))];
  const moderate = [...copies(10, s(3, "B")), ...copies(10, s(4, "B"))];
  const difficult = [...copies(15, s(3, "C")), ...copies(5, s(2, "C"))];
  expect(
    [easy, moderate, difficult].map(
      (shots) => playerEventStats(shots).adjusted,
    ),
  ).toEqual([85, 85, 85]);
  expect(playerEventStats(copies(10, s(5, "C"))).adjusted).toBe(130);
  const unknown = {
    ...s(0),
    difficulty: undefined,
    difficultyEstimate: { counts: { A: 0, B: 0, C: 10 } },
  } as AnalysisShot;
  const stats = playerEventStats([
    ...easy,
    unknown,
    s(null, "C"),
    { ...s(5, "C"), excluded: "Pick" },
  ]);
  expect(stats).toMatchObject({
    adjusted: 85,
    ratedGraded: 20,
    observed: 21,
    attempts: 22,
  });
  expect(
    playerEventStats([...easy, ...copies(10, unknown)]).adjusted,
  ).toBeNull();
  expect(playerEventStats(copies(10, s(0))).adjusted).toBe(0);
});
it("compares a player's completed earlier events and prints assessed zeros and missing coverage separately", () => {
  const first = event("first", "2026-01-01", copies(10, s(4)));
  const current = event("current", "2026-03-01", copies(12, s(3, "B")));
  const open = event("open", "2026-02-01", copies(20, s(0)));
  open.games[0].status = "active";
  const future = event("future", "2026-04-01", copies(20, s(5)));
  const data = reportEventPerformance(
    { ...current, performanceHistory: [future, first, open] },
    "lead",
    true,
  );
  const saved = {
    playerId: "lead",
    eventPerformance: data,
    narrative: { practice: [] },
  } as unknown as SavedReport;
  const card = playerScorecard(saved)!;
  expect(card.prior.map((p) => p.name)).toEqual(["first"]);
  expect(playerScorecardCards(card.current)[1].value).toBe("75.0 pts");
  expect(card.current.playerStats).toMatchObject({
    classified: 12,
    misses: 12,
    tagged: 0,
  });
  const blocks = playerScorecardBlocks(saved, card);
  expect(JSON.stringify(blocks)).toContain("100.0% (12/12)");
  expect(JSON.stringify(blocks)).not.toMatch(
    /future|routine baseline|season difficulty index/i,
  );
});
it("pools historical routine shots without requiring subtype labels", () => {
  const history = [
    ...copies(5, s(5)),
    ...copies(5, s(3, "A", "lead", "other")),
    ...copies(8, s(0, "A", "other")),
  ];
  const current = [
    s(4),
    s(4, "A", "lead", "other"),
    s(0, "A", "unknown"),
    s(0, "A", "lead", null),
  ];
  const m = baselineMetrics(current, history);
  expect(m.routinePercent).toBe(40);
  expect(m.matchedRoutineShots).toBe(4);
  expect(m.matchedRoutinePercent).toBe(40);
  expect(m.expectedRoutinePercent).toBeCloseTo(800 / 18);
  expect(m.baselineGap).toBeCloseTo(40 - 800 / 18);
});
it("excludes picks, ungraded and unrated shots; retains grade zero", () => {
  const pick = { ...s(null, "C"), excluded: "Pick" } as AnalysisShot;
  const m = baselineMetrics(
    [s(0), s(5, "C"), s(null, "C"), pick, { ...s(5), difficulty: undefined }],
    copies(5, s(5)),
  );
  expect(m.gradedShots).toBe(3);
  expect(m.ratedShots).toBe(2);
  expect(m.routineShots).toBe(1);
  expect(m.routinePercent).toBe(0);
  expect(m.baselineGap).toBe(-100);
  expect(m.difficultyIndex).toBe(200);
  expect(m.difficultShare).toBe(50);
  expect(baselineMetrics([s(5)], copies(1, s(5))).baselineGap).toBe(0);
});
it("uses all earlier completed same-season events and excludes future, overlap and foreign history", () => {
  const history = Array.from({ length: 7 }, (_, i) =>
    event(`e${i}`, `2026-01-0${i + 1}`, copies(5, s(i === 0 ? 0 : 5))),
  );
  const current = event("current", "2026-02-01", copies(5, s(4)));
  const future = event("future", "2026-03-01", copies(5, s(0)));
  const foreign = event("foreign", "2026-01-20", copies(5, s(0)));
  foreign.organizationId = "another";
  const overlap = event("overlap", "2026-01-21", copies(5, s(0)));
  overlap.games[0].scheduledStart = "2026-02-02";
  const open = event("open", "2026-01-22", copies(5, s(0)));
  open.games[0].status = "active";
  const result = eventPerformance([
    future,
    current,
    ...history,
    foreign,
    overlap,
    open,
  ]).points.find((p) => p.id === "current")!;
  expect(result.baselineEvents).toBe(7);
  expect(result.expectedRoutinePercent).toBeCloseTo(600 / 7);
  expect(result.baselineGap).toBeCloseTo(80 - 600 / 7);
  current.performanceHistory = [...history, future, foreign, overlap];
  expect(reportEventPerformance(current).points.map((p) => p.id)).not.toContain(
    "overlap",
  );
  expect(reportEventPerformance(current).points.map((p) => p.id)).not.toContain(
    "future",
  );
  expect(reportEventPerformance(current).points.map((p) => p.id)).not.toContain(
    "foreign",
  );
});
it("pools points rather than game percentages and preserves empty event gaps and individual isolation", () => {
  const first = event("first", "2026-01-01", copies(1, s(0)));
  first.games.push(
    ...event("extra", "2026-01-01", copies(9, s(5, "A", "other"))).games,
  );
  const empty = event("empty", "2026-02-01", []);
  expect(eventPerformance([first, empty]).points[0].percent).toBe(90);
  expect(eventPerformance([first, empty]).points[1].percent).toBeNull();
  expect(eventPerformance([first], "lead").points[0].percent).toBe(0);
});
it("puts bounded trend evidence into team, coach and player prompts without API calls", () => {
  const first = event("first", "2026-01-01", copies(5, s(5)));
  const current = event("current", "2026-02-01", copies(5, s(4)));
  current.games[0].state.roster = [
    { id: "lead", name: "Player", position: "Lead" },
  ];
  current.performanceHistory = [first];
  for (const audience of ["team", "coach", "players"] as const) {
    const input = reportInputs(current, audience)[0];
    expect(input.eventPerformance?.points).toHaveLength(2);
    expect(
      selectPromptEvidence(input).some((e) => e.id === "event-trend-baseline"),
    ).toBe(true);
  }
  expect(
    performanceEvidence(reportEventPerformance(current)).some(
      (e) => e.id === "event-trend-type-0",
    ),
  ).toBe(true);
});

it("uses the same shot-weighted season reference for first and later events without altering routine history", () => {
  const first = event("first", "2026-01-01", [s(5, "A")]);
  const second = event("second", "2026-02-01", [s(3, "C"), s(4, "B")]);
  const result = eventPerformance([second, first], "lead");
  expect(result.points.map((p) => p.seasonDifficulty)).toEqual([2, 2]);
  expect(result.points[0].games[0].seasonDifficulty).toBe(2);
  expect(result.points[0].baselineDifficulty).toBeNull();
  expect(result.points[0].routineShots).toBe(1);
  expect(result.points[0].baselineGap).toBeNull();
  expect(result.points[1].baselineDifficulty).toBe(1);
});
