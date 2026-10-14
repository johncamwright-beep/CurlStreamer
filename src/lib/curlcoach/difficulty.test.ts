import { describe, expect, it } from "vitest";
import { append, currentShots, emptyState, report, type Shot } from "./model";
import {
  difficultySummary,
  difficultyRecords,
  withDifficulty,
  difficultyPercent,
  difficultyPAE,
  difficultyBenchmarks,
  difficultyIdentity,
  type DifficultyShot,
} from "./difficulty";
import { emptySupplement } from "./enhanced-catalog";
import {
  difficultyEventShots,
  difficultyGameShots,
  sampleEvent,
} from "./event";
import { reportInputs, REPORT_INSTRUCTIONS } from "./reports";
import type { EnhancedDocument } from "@/lib/providers/shot-tracker-enhanced";
const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 5,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
const s = (
  grade: number | null,
  difficulty?: DifficultyShot["difficulty"],
): DifficultyShot => ({ ...shot, grade, difficulty });
describe("difficulty adjusted shooting", () => {
  it("compares different player difficulty profiles using the same benchmark set", () => {
    const profiles = [
      {
        player: "lead",
        level: "A" as const,
        makes: 19,
        actual: 95,
        adjusted: 80,
      },
      {
        player: "second",
        level: "B" as const,
        makes: 17,
        actual: 85,
        adjusted: 85,
      },
      {
        player: "third",
        level: "C" as const,
        makes: 16,
        actual: 80,
        adjusted: 95,
      },
    ];
    const rows = profiles.flatMap((p) =>
      Array.from({ length: 20 }, (_, i) => ({
        ...s(i < p.makes ? 5 : 0, p.level),
        playerId: p.player,
      })),
    );
    for (const p of profiles) {
      const pool = rows.filter((s) => s.playerId === p.player);
      expect(report(pool).percent).toBeCloseTo(p.actual);
      expect(difficultySummary(pool).adjusted).toBeCloseTo(p.adjusted);
    }
    expect(difficultySummary(rows).adjusted).toBeCloseTo((80 + 85 + 95) / 3);
  });
  it.each([
    ["A", 85, 85],
    ["B", 70, 100],
    ["C", 55, 115],
  ] as const)(
    "calculates a perfect %s shot against its benchmark",
    (level, expected, adjusted) => {
      const result = difficultySummary([s(5, level)]);
      expect(result.expected).toBeCloseTo(expected);
      expect(result.adjusted).toBe(adjusted);
      expect(result.pae).toBeCloseTo(100 - expected);
    },
  );
  it("weights each shot rather than game averages and leaves traditional unchanged", () => {
    const rows = [
      s(5, "A"),
      s(4, "B"),
      s(2, "C"),
      s(0, "C"),
      s(5),
      s(null, "A"),
      { ...s(5, "A"), excluded: "Pick" as const },
    ];
    const before = structuredClone(rows);
    const traditional = report(rows);
    const d = difficultySummary(rows);
    expect(d.eligible).toBe(5);
    expect(d.classified).toBe(4);
    expect(d.coverage).toBe(80);
    expect(d.actual).toBeCloseTo(55);
    expect(d.expected).toBeCloseTo(66.25);
    expect(d.pae).toBeCloseTo(-11.25);
    expect(d.adjusted).toBeCloseTo(58.75);
    expect(d.mix.map((r) => r.count)).toEqual([1, 1, 2]);
    expect(report(rows)).toEqual(traditional);
    expect(traditional.percent).toBe(64);
    expect(rows).toEqual(before);
  });
  it("treats absent, invalid and unavailable classifications as unknown, with N/A for none", () => {
    const d = difficultySummary([
      s(5),
      { ...s(0), difficulty: "D" as "A" },
      { ...s(2, "A"), difficultyUnavailable: true },
    ]);
    expect(d.eligible).toBe(3);
    expect(d.classified).toBe(0);
    expect(d.unavailable).toBe(1);
    expect(d.adjusted).toBeNull();
    expect(d.pae).toBeNull();
    expect(d.coverage).toBe(0);
    expect(difficultySummary([]).coverage).toBeNull();
    expect(difficultyPercent(d.adjusted)).toBe("N/A");
  });
  it("never clamps, rounds only presentation, and supports a common configurable model", () => {
    expect(difficultySummary([s(0, "A")]).adjusted).toBe(-15);
    expect(difficultySummary([s(5, "C")]).adjusted).toBe(115);
    const d = difficultySummary([s(1, "A"), s(4, "B"), s(5, "B")]);
    expect(d.adjusted).toBeCloseTo(61.66666667);
    expect(difficultyPercent(d.adjusted)).toBe("61.7%");
    expect(difficultyPAE(d.pae)).toBe("-8.3 pp");
    expect(
      difficultySummary([s(5, "C")], {
        version: "test",
        baseline: 50,
        expected: { A: 90, B: 80, C: 60 },
      }).adjusted,
    ).toBe(90);
    expect(() =>
      difficultySummary([], { ...difficultyBenchmarks, baseline: 101 }),
    ).toThrow();
  });
  it("follows corrections, difficulty edits, clearing, deletion and append-only undo", () => {
    const id = crypto.randomUUID();
    let state = append(
      emptyState(),
      { requestId: crypto.randomUUID(), expectedRevision: 0, shotId: id, shot },
      "coach",
    );
    const value = emptySupplement();
    value.values.difficulty = "very_demanding";
    const doc: EnhancedDocument = {
      kind: "supplement",
      shotId: id,
      sourceRevision: 1,
      revision: 1,
      at: "now",
      value,
    };
    const calculate = () =>
      difficultySummary(
        currentShots(state.events).map((s) =>
          withDifficulty(s, difficultyRecords(state, [doc]), true),
        ),
      );
    expect(calculate().adjusted).toBe(115);
    const change = (next: Shot | null) => {
      state = append(
        state,
        {
          requestId: crypto.randomUUID(),
          expectedRevision: state.revision!,
          shotId: id,
          shot: next,
        },
        "coach",
      );
    };
    change({ ...shot, grade: 0 });
    expect(calculate().adjusted).toBeCloseTo(15);
    value.values.difficulty = "routine";
    doc.revision++;
    expect(calculate().adjusted).toBe(-15);
    delete value.values.difficulty;
    expect(calculate().adjusted).toBeNull();
    value.values.difficulty = "routine";
    change(null);
    expect(calculate().eligible).toBe(0);
    change(shot);
    expect(calculate().adjusted).toBe(85);
    change({ ...shot, playerId: "other" });
    expect(calculate().adjusted).toBeNull();
    expect(state.events[0].shot).toEqual(shot);
  });
  it("invalidates stale identity and reconciles incompatible shot calls without inventing difficulty", () => {
    const event = sampleEvent("practice"),
      g = event.games[0];
    const state = append(
      emptyState(),
      {
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        shotId: crypto.randomUUID(),
        shot,
      },
      "coach",
    );
    g.state = state;
    const value = emptySupplement();
    value.values.difficulty = "routine";
    const doc: EnhancedDocument = {
      kind: "supplement",
      shotId: state.events[0].shotId,
      sourceRevision: 1,
      revision: 1,
      at: "now",
      value,
      conflicts: ["source shot subtype requires reconciliation"],
    };
    expect(difficultyRecords(state, [doc])[0].level).toBeUndefined();
    doc.conflicts = [];
    g.difficultyRecords = difficultyRecords(state, [doc]);
    g.difficultyReady = true;
    expect(difficultySummary(difficultyGameShots(g)).classified).toBe(1);
    g.state = append(
      state,
      {
        requestId: crypto.randomUUID(),
        expectedRevision: 1,
        shotId: doc.shotId!,
        shot: { ...shot, stone: 2 },
      },
      "coach",
    );
    expect(difficultySummary(difficultyGameShots(g)).classified).toBe(0);
  });
  it("aggregates players, games, events and season by eligible shots; reports share the calculation", () => {
    const event = sampleEvent("shorty-example");
    event.games.forEach((g, i) => {
      g.difficultyReady = true;
      g.difficultyRecords = currentShots(g.state.events).map((s) => ({
        shotId: s.id,
        identity: difficultyIdentity(s),
        level: i % 2 ? "C" : "A",
        revision: 1,
      }));
    });
    const rows = difficultyEventShots(event);
    const expected = difficultySummary(rows);
    const team = reportInputs(event, "team")[0];
    expect(team.difficulty).toEqual(expected);
    expect(reportInputs(event, "coach")[0].difficulty).toEqual(expected);
    expect(team.evidence.find((e) => e.id === "overall")?.value).toContain(
      `${report(rows).percent!.toFixed(1)}%`,
    );
    expect(team.evidence.find((e) => e.id === "difficulty")?.value).toContain(
      "not official Curling Canada",
    );
    expect(team.evidence.some((e) => e.id === "game-1-difficulty-C")).toBe(
      true,
    );
    const players = reportInputs(event, "players");
    expect(players.reduce((n, p) => n + p.difficulty!.classified, 0)).toBe(
      expected.classified,
    );
    expect(players[0].games![0].difficulty).toBeDefined();
    const season = {
      ...event,
      games: [
        ...event.games,
        ...event.games.map((g) => ({
          ...g,
          id: g.id + "-another-event",
          eventId: "another-event",
        })),
      ],
    };
    expect(
      difficultySummary(difficultyEventShots(season)).adjusted,
    ).toBeCloseTo(expected.adjusted!);
    expect(difficultySummary(difficultyEventShots(season)).classified).toBe(
      2 * expected.classified,
    );
    expect(REPORT_INSTRUCTIONS).toContain("SAME classified subset");
  });
});
