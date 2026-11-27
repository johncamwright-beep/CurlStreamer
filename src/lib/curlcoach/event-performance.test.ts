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
  matrixChange,
  matrixPoints,
  totalCellFill,
  type ReportMatrix,
} from "./report-matrix";
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
      type: value.type,
      end: i + 1,
      grade: value.grade,
      execution: value.execution,
      deficiency: value.deficiency,
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
      resultObservations: value.resultObservations ?? null,
      observedMisses: value.observedMisses,
      destinationAssessment: "not_assessed",
      resultAssessment: "not_assessed",
      analysisStatus: "available",
    });
  });
  return e;
}
it("shows recurring same-shot pairs with pooled, observed denominators", () => {
  const over = {
    ...s(2),
    deficiency: "Overcurl" as const,
    resultObservations: ["over_curl"],
  };
  const wreck = {
    ...s(2),
    type: "Come Around" as const,
    observedMisses: ["wreck_on_guard"],
    resultObservations: ["wreck"],
  };
  const prior = event("previous", "2026-01-01", [
    ...copies(2, over),
    ...copies(2, wreck),
    { ...s(2), observedDestination: "in_house" },
    { ...over, excluded: "Pick" },
    { ...over, playerId: "skip" },
  ]);
  const current = event("current", "2026-02-01", [
    ...copies(2, { ...s(1), deficiency: "Light" }),
    { ...s(2), deficiency: "Heavy" },
    ...copies(2, {
      ...s(2),
      type: "Peel",
      observedMisses: ["flash_wide"],
      resultObservations: ["flash", "flash_wide"],
    }),
    { ...over, execution: "Make" },
  ]);
  const data = reportEventPerformance(
    { ...current, performanceHistory: [prior] },
    "lead",
    true,
  );
  const saved = {
    playerId: "lead",
    eventPerformance: data,
    narrative: { eventStats: [], eventTrends: [] },
  } as unknown as SavedReport;
  const [games, trends] = playerScorecardBlocks(
    saved,
    playerScorecard(saved)!,
  ) as ReportMatrix[];
  const pairs = (m: ReportMatrix) =>
    m.groups.find((g) => g.title.startsWith("Recurring misses"))!.rows;
  const reasons = trends.groups.find((g) =>
    g.title.startsWith("Miss reasons"),
  )!.rows;
  expect(reasons.find((r) => r.label === "Wreck on guard")?.total.sample).toBe(
    "2/10",
  );
  expect(
    reasons.some((r) => r.label === "Wreck" || r.label === "In-House"),
  ).toBe(false);
  expect(reasons.find((r) => r.label === "Overcurl")?.total.sample).toBe(
    "3/10",
  );
  expect(pairs(games).map((r) => r.label)).toEqual([
    "Peel · Flash Wide",
    "Draw · Light",
  ]);
  expect(pairs(trends).map((r) => r.label)).toEqual([
    "Come Around · Wreck on guard",
    "Peel · Flash Wide",
    "Draw · Overcurl",
    "Draw · Light",
  ]);
  expect(pairs(trends)[0].cells).toEqual([
    { value: 100, sample: "2/2" },
    { value: null },
  ]);
  expect(pairs(trends)[2]).toMatchObject({
    cells: [
      { value: 100, sample: "2/2" },
      { value: 25, sample: "1/4" },
    ],
    total: { value: 50, sample: "3/6" },
    better: "neutral",
  });
});
it("uses one easy-shot scale for players and keeps estimates outside observed difficulty", () => {
  const easy = [...copies(15, s(4)), ...copies(5, s(5))];
  const moderate = [...copies(10, s(3, "B")), ...copies(10, s(4, "B"))];
  const difficult = [...copies(15, s(3, "C")), ...copies(5, s(2, "C"))];
  expect(
    [easy, moderate, difficult].map(
      (shots) => playerEventStats(shots).adjusted,
    ),
  ).toEqual([85, 85, 85]);
  expect(playerEventStats(copies(10, s(5, "C"))).adjusted).toBe(100);
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
  expect(playerEventStats([...easy, ...copies(10, unknown)]).adjusted).toBe(85);
  expect(playerEventStats([unknown]).adjusted).toBeNull();
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
  expect(playerScorecardCards(card.current, card.prior)).toEqual([
    { label: "Shooting", value: "60.0%" },
    { label: "Difficulty-adjusted shooting", value: "75.0%" },
    { label: "Event difficulty", value: "2.0/3 · Harder" },
    { label: "Routine shooting", value: "—" },
  ]);
  expect(playerScorecardCards(card.prior[0], []).at(-1)?.value).toBe("80.0%");
  expect(card.current.playerStats).toMatchObject({
    classified: 12,
    misses: 12,
    tagged: 0,
  });
  const blocks = playerScorecardBlocks(saved, card);
  const matrices = blocks.filter((b): b is ReportMatrix => b.kind === "matrix");
  expect(matrices.map((m) => m.title)).toEqual([
    "Event Stats",
    "Trends over time (by event)",
  ]);
  for (const m of matrices) {
    const outcomes = m.groups.find((g) =>
      g.title.startsWith("Shot outcomes"),
    )!.rows;
    expect(outcomes.map((r) => r.label)).toEqual([
      "Partial",
      "Complete miss",
      "Limited",
      "Make",
    ]);
    expect(outcomes[0].cells.at(-1)).toEqual({ value: 100, sample: "12/12" });
    expect(outcomes[3].cells.at(-1)).toEqual({ value: 0, sample: "0/12" });
    expect(m.groups.some((g) => g.title.startsWith("Miss reasons"))).toBe(
      false,
    );
  }
  expect(JSON.stringify(blocks)).not.toMatch(
    /future|routine baseline|season difficulty index/i,
  );
});
it("compares every game and the last five events with distinct counts, genuine zeroes and gaps", () => {
  const recent = Array.from({ length: 6 }, (_, i) =>
    event("Event " + i, `2026-01-0${i + 1}`, copies(2, s(i === 1 ? 0 : 3))),
  );
  const current = recent.pop()!;
  const extra = Array.from(
    { length: 6 },
    (_, i) =>
      event(
        "Game " + (i + 2),
        current.startDate!,
        i === 4 ? [] : copies(1, s(5)),
      ).games[0],
  );
  extra[0] = event("Peel game", current.startDate!, [
    { ...s(4), type: "Peel" },
  ]).games[0];
  current.games.push(...extra);
  current.performanceHistory = recent;
  const saved = {
    playerId: "lead",
    eventPerformance: reportEventPerformance(current, "lead", true),
    narrative: { practice: [] },
  } as unknown as SavedReport;
  const [games, events] = playerScorecardBlocks(
    saved,
    playerScorecard(saved)!,
  ).filter((b): b is ReportMatrix => b.kind === "matrix");
  expect(games.columns.map((c) => c.key)).toEqual([
    "G1",
    "G2",
    "G3",
    "G4",
    "G5",
    "G6",
    "G7",
  ]);
  expect(events.columns.map((c) => c.name)).toEqual([
    "Event 1",
    "Event 2",
    "Event 3",
    "Event 4",
    "Event 5",
  ]);
  const rows = (m: ReportMatrix) =>
    m.groups.find((g) => g.title === "Shot performance")!.rows;
  for (const matrix of [games, events]) {
    for (const group of matrix.groups) {
      const totals = group.rows.map((r) => r.total.value ?? -1);
      expect(totals).toEqual([...totals].sort((a, b) => b - a));
    }
  }
  const draw = rows(events).find((r) => r.label === "Draw")!;
  expect(draw.cells[0]).toEqual({ value: 0, sample: "2" });
  expect(draw.cells.at(-1)?.value).toBeCloseTo((100 * 26) / 30);
  expect(draw.total.sample).toBe("14");
  expect(draw.total.value).toBeCloseTo((100 * (26 + 18)) / 70);
  expect(matrixChange(draw).text).toBe("+86.7 pp");
  const gameDraw = rows(games).find((r) => r.label === "Draw")!;
  expect(gameDraw.total).toEqual(draw.cells.at(-1));
  expect(gameDraw.cells[5].value).toBeNull();
  expect(matrixPoints(gameDraw).map((point) => point.x)).toEqual([
    0,
    2 / 6,
    3 / 6,
    4 / 6,
    1,
  ]);
  expect(matrixChange(gameDraw).text).toBe("+40.0 pp");
  expect(matrixChange(rows(events).find((r) => r.label === "Peel")!).text).toBe(
    "—",
  );
});
it("compares this player's measured calls by shot count, including ungraded calls", () => {
  const easy = event("easy", "2026-01-01", [s(4)]);
  const hard = event("hard", "2026-01-03", copies(9, s(null, "C")));
  const current = event("now", "2026-01-06", [
    s(4, "B"),
    ...copies(10, s(5, "A", "teammate")),
  ]);
  current.performanceHistory = [easy, hard];
  const saved = {
    playerId: "lead",
    eventPerformance: reportEventPerformance(current, "lead", true),
  } as SavedReport;
  const card = playerScorecard(saved)!;
  expect(playerScorecardCards(card.current, card.prior)[2].value).toBe(
    "2.0/3 · Easier",
  );
  expect(card.current.playerStats.adjusted).toBe(95);
});
it("pools the measured grades and applies the percentage ceiling once to the total", () => {
  const hard = event("hard", "2026-01-01", [s(5, "C")]);
  const easy = event("easy", "2026-01-03", [s(0, "A")]);
  easy.performanceHistory = [hard];
  const saved = {
    playerId: "lead",
    eventPerformance: reportEventPerformance(easy, "lead", true),
    narrative: { practice: [] },
  } as unknown as SavedReport;
  const charts = playerScorecardBlocks(saved, playerScorecard(saved)!).filter(
    (b): b is ReportMatrix => b.kind === "matrix",
  );
  const adjusted = charts[1].groups[0].rows.find(
    (r) => r.label === "Difficulty-adjusted",
  )!;
  expect(adjusted.cells.map((c) => c.value)).toEqual([100, 0]);
  expect(adjusted.total).toEqual({ value: 65, sample: "2" });
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

it("connects measured points across missing events and grounds player notes in the charted shot and miss", () => {
  const prior = event("Private old event", "2026-01-01", copies(4, s(3)));
  const gap = event("Private middle event", "2026-02-01", [
    { ...s(2), type: "Peel" },
  ]);
  const now = event("Private current event", "2026-03-01", [
    ...copies(3, s(4)),
    s(0, "C", "other"),
  ]);
  now.games[0].state.roster = [
    { id: "lead", name: "Private Name", position: "Lead" },
  ];
  for (const e of [prior, now]) {
    const g = e.games[0];
    for (const record of g.analysisRecords!)
      record.observedMisses = ["wreck_on_guard"];
    g.advancedReady = true;
    g.advancedRecords = g.state.events.flatMap((row) => {
      if (!row.shot) return [];
      row.shot.deficiency = "Overcurl";
      return [
        {
          shotId: row.shotId,
          identity: difficultyIdentity(row.shot),
          revision: 1,
          valid: true,
          needsReview: false,
          values: { misses: ["wreck_on_guard"] },
          assessments: { misses: "assessed" },
        },
      ];
    });
  }
  now.performanceHistory = [prior, gap];
  const input = reportInputs(now, "players")[0];
  const proof = input.sectionEvidence!;
  expect(
    proof.find(
      (e) =>
        e.id.startsWith("event-") &&
        e.label === "Draw · Tagged miss · Wreck on guard",
    )?.value,
  ).toBe("G1=3/3; Total=3/3");
  expect(
    proof.find(
      (e) =>
        e.id.startsWith("events-") &&
        e.label === "Draw · Tagged miss · Overcurl",
    )?.value,
  ).toBe("E1=4/4; E2=—; E3=3/3; Total=7/7");
  expect(JSON.stringify(proof)).not.toMatch(/Private|other/);
  const saved = {
    ...input,
    playerId: "lead",
    narrative: {
      eventStats: [
        { text: "You repeatedly caught the guard on draws.", evidence: [] },
      ],
      eventTrends: [],
    },
  };
  const matrices = playerScorecardBlocks(saved, playerScorecard(saved)!).filter(
    (b): b is ReportMatrix => b.kind === "matrix",
  );
  expect(matrices[0].narrative).toContain("guard");
  expect(matrices[1].narrative).toBe("");
  const draw = matrices[1].groups
    .find((g) => g.title === "Shot performance")!
    .rows.find((r) => r.label === "Draw")!;
  expect(matrixPoints(draw).map((p) => p.x)).toEqual([0, 1]);
  expect(draw.cells[1].value).toBeNull();
});
it("ranks up to fifteen recurring pairs from the full list in each matrix", () => {
  const tags = [
    "light",
    "heavy",
    "over_curl",
    "wreck_on_guard",
    "overswept",
    "half_shot",
  ];
  const types = ["Draw", "Peel", "Hit & Roll"] as const;
  const shots = types.flatMap((type, t) =>
    tags.flatMap((tag, i) =>
      copies(t * tags.length + i + 2, {
        ...s(3),
        type,
        resultObservations: [tag],
      }),
    ),
  );
  const selected = event("qualifier", "2026-11-20", shots);
  const saved = {
    playerId: "lead",
    eventPerformance: reportEventPerformance(selected, "lead", true),
    narrative: { eventStats: [], eventTrends: [] },
  } as unknown as SavedReport;
  for (const matrix of playerScorecardBlocks(
    saved,
    playerScorecard(saved)!,
  ).filter((b): b is ReportMatrix => b.kind === "matrix")) {
    const rows = matrix.groups.find((group) =>
      group.title.startsWith("Recurring misses by shot"),
    )!.rows;
    expect(rows).toHaveLength(15);
    expect(rows[0].label).toBe("Draw · Half Shot");
    expect(
      rows
        .map((r) => Number(r.total.sample!.split("/")[0]))
        .sort((a, b) => b - a),
    ).toEqual(Array.from({ length: 15 }, (_, i) => 19 - i));
  }
});

it("assigns the six shooting bands using the displayed percentage and leaves shares and gaps neutral", () => {
  const fill = (value: number | null) => totalCellFill("shooting", { value });
  const bands = [50, 60, 69.9, 79.9, 84.9, 100].map(fill);
  expect(new Set(bands).size).toBe(6);
  expect([0, 50.1, 60.1, 70, 80, 85].map(fill)).toEqual(bands);
  expect(fill(84.96)).toBe(fill(85));
  expect(totalCellFill("share", { value: 100 })).toBe(fill(null));
  expect(bands).not.toContain(fill(null));
});
