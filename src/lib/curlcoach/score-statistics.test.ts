import { describe, expect, it } from "vitest";
import { scoreboard, type CoachGame } from "./event";
import { emptyState } from "./model";
import {
  observedEnds,
  situationWins,
  teamScoreStatistics,
} from "./score-statistics";
function game(
  scores: [number, number][],
  overrides: Partial<CoachGame> = {},
): CoachGame {
  const events = scores.map(([us, them], i) => ({
    id: String(i),
    at: i,
    type: "end" as const,
    score: {
      end: i + 1,
      team: us ? ("home" as const) : them ? ("away" as const) : null,
      points: us || them,
      blank: !us && !them,
    },
  }));
  return {
    id: "test",
    eventId: "event",
    label: "Game",
    teamName: "Us",
    opponent: "Them",
    scheduledEnds: 8,
    status: "completed",
    side: "home",
    initialHammer: "home",
    scoreboardAvailable: true,
    ends: scoreboard({ initialHammer: "home" }, events, "home"),
    state: emptyState(),
    ...overrides,
  };
}
describe("line score coaching statistics", () => {
  it("uses hammer before each end, retains it through blanks, and compares both teams", () => {
    const g = game([
      [0, 0],
      [2, 0],
      [1, 0],
      [0, 1],
      [0, 2],
      [0, 0],
      [1, 0],
      [0, 2],
    ]);
    const ours = teamScoreStatistics([g]);
    expect(ours.scoring).toEqual({ count: 2, total: 5, percent: 40 });
    expect(ours.multiple.count).toBe(1);
    expect(ours.steals).toMatchObject({ count: 1, total: 3 });
    expect(ours.forceOne).toMatchObject({ count: 1, total: 3 });
    expect(ours.blankWith.count).toBe(2);
    expect(ours.stolenAgainst.count).toBe(1);
    const opponents = teamScoreStatistics([g], true);
    expect(opponents.steals).toEqual(ours.stolenAgainst);
    expect(opponents.scoring).toMatchObject({ count: 2, total: 3 });
    expect(teamScoreStatistics([g, g]).scoring).toEqual({
      count: 4,
      total: 10,
      percent: 40,
    });
  });
  it("honours explicit hammer changes, unknown hammer, away side, and missing ends", () => {
    const g = game([[0, 1]]);
    g.ends = scoreboard(
      {},
      [
        { id: "h", at: 0, type: "hammer", team: "away" },
        {
          id: "e",
          at: 1,
          type: "end",
          score: { end: 1, team: "away", points: 1, blank: false },
        },
      ],
      "home",
    );
    expect(observedEnds(g)[0].hammer).toBe(false);
    const unknown = game([[0, 0]], {
      initialHammer: null,
      ends: [{ end: 1, us: 0, them: 0, hammer: null }],
    });
    expect(teamScoreStatistics([unknown]).scoring.percent).toBeNull();
    expect(teamScoreStatistics([unknown]).unknownHammer).toBe(1);
    expect(teamScoreStatistics([unknown]).blanks.percent).toBe(100);
    const away = {
      ...unknown,
      side: "away" as const,
      initialHammer: "away" as const,
    };
    expect(observedEnds(away)[0].hammer).toBe(true);
    const gap = game([[1, 0]], {
      ends: [{ end: 3, us: 1, them: 0, hammer: false }],
    });
    expect(observedEnds(gap)[0]).toMatchObject({
      hammer: null,
      difference: null,
    });
    expect(situationWins([gap], 3)).toHaveLength(0);
  });
  it("counts final outcomes once per completed game from the position entering the chosen end", () => {
    const prefix: [number, number][] = [
      [0, 1],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ];
    const win = game([...prefix, [2, 0]]),
      loss = game([...prefix, [0, 1]]),
      tie = game([...prefix, [1, 0]]);
    const active = { ...win, status: "active" },
      early = game(prefix),
      noScores = { ...win, scoreboardAvailable: false };
    const rows = situationWins(
      [win, loss, tie, active, early, noScores],
      "final",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      difference: -1,
      hammer: true,
      wins: 1,
      losses: 1,
      ties: 1,
      count: 1,
      total: 3,
    });
    expect(rows[0].percent).toBeCloseTo(100 / 3);
    expect(situationWins([win], 7)[0]).toMatchObject({
      difference: -1,
      wins: 1,
      total: 1,
    });
  });
  it("uses scheduled length for ten ends, final results after extra ends, and ignores early finishes", () => {
    const zeros: [number, number][] = Array.from({ length: 9 }, () => [0, 0]);
    const ten = game([...zeros, [0, 0], [0, 1]], { scheduledEnds: 10 });
    expect(situationWins([ten], "final")[0]).toMatchObject({
      difference: 0,
      hammer: true,
      wins: 0,
      losses: 1,
      total: 1,
    });
    expect(situationWins([ten], 11)[0]).toMatchObject({ losses: 1 });
    expect(situationWins([game([[3, 0]])], "final")).toEqual([]);
  });
});
