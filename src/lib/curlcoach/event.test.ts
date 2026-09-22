import { expect, it } from "vitest";
import {
  eventShots,
  family,
  gameShots,
  matrix,
  outcomePercent,
  sampleEvent,
  scoreboard,
  grouped,
  workbookCategoryPercent,
} from "./event";
import { append, report } from "./model";
it("aggregates every game in an event and isolates player and game selections", () => {
  const event = sampleEvent("shorty-example");
  const shots = eventShots(event);
  expect(event.games).toHaveLength(7);
  expect(shots).toHaveLength(448);
  expect(shots.filter((s) => s.playerId === "lead")).toHaveLength(112);
  expect(gameShots(event.games[6])).toHaveLength(64);
  const before = report(shots);
  const game = event.games[6];
  const original = gameShots(game).find(
    (s) => s.grade !== null && !s.excluded,
  )!;
  const { id, ...shot } = original;
  game.state = append(
    game.state,
    {
      requestId: crypto.randomUUID(),
      shotId: id,
      expectedRevision: game.state.events.length,
      shot: { ...shot, grade: 0 },
    },
    "synthetic-coach",
  );
  expect(report(eventShots(event)).percent).toBeLessThan(before.percent!);
  expect(eventShots(sampleEvent("practice"))).toHaveLength(0);
});
it("exposes workbook category denominator separately from graded-attempt percentage", () => {
  const shot = gameShots(sampleEvent("shorty-example").games[0]).find(
    (s) => !s.excluded,
  )!;
  const rows = [
    { ...shot, grade: 5 },
    { ...shot, grade: null },
  ];
  expect(report(rows).percent).toBe(100);
  expect(workbookCategoryPercent(rows)).toBe(50);
  expect(
    matrix(
      rows,
      [family(shot)!],
      [shot.execution!],
      family,
      (s) => s.execution,
    )[0].values,
  ).toEqual([2]);
});
it("adds an aggregate hit group using the numeric-grade shooting denominator", () => {
  const shot = gameShots(sampleEvent("shorty-example").games[0]).find(
    (s) => s.type === "Peel" && !s.excluded,
  )!;
  const rows = [
    { ...shot, grade: 5 },
    { ...shot, grade: 0 },
    { ...shot, grade: null },
    { ...shot, type: "Runback/Multiple" as const, grade: null },
  ];
  const groups = grouped(
    rows,
    ["Peel", "Runback/Multiple"],
    (s) => s.type,
    "All Hits",
  );
  expect(groups[0]).toMatchObject({
    label: "All Hits",
    attempts: 4,
    scored: 2,
    missing: 2,
    percent: 50,
  });
  expect(groups[2].percent).toBeNull();
  expect(
    grouped(
      [
        { ...shot, turn: "CW C" as const, grade: 0 },
        { ...shot, turn: null, grade: 5 },
      ],
      ["CW C"],
      (s) => s.turn,
      "All Turns",
      () => true,
    )[0].percent,
  ).toBe(50);
  expect(
    outcomePercent(
      [
        { ...shot, deficiency: "Make" as const },
        { ...shot, deficiency: "Light" as const },
        { ...shot, deficiency: null },
        { ...shot, deficiency: "Make" as const, excluded: "Pick" as const },
      ],
      "Make",
    ),
  ).toBe(50);
  expect(outcomePercent([{ ...shot, deficiency: null }], "Make")).toBeNull();
});
it("derives actual scoreboard ends with Undo, blank-end hammer retention and extra ends", () => {
  expect(
    scoreboard(
      { initialHammer: "away" },
      [
        {
          id: "a",
          at: 0,
          type: "end",
          score: { end: 1, team: "away", points: 2, blank: false },
        },
        { id: "u", at: 1, type: "undo", targetId: "a" },
        {
          id: "b",
          at: 2,
          type: "end",
          score: { end: 1, team: null, points: 0, blank: true },
        },
        {
          id: "c",
          at: 3,
          type: "end",
          score: { end: 11, team: "home", points: 1, blank: false },
        },
      ],
      "home",
    ),
  ).toEqual([
    { end: 1, us: 0, them: 0, hammer: false, hammerBefore: false },
    { end: 11, us: 1, them: 0, hammer: false, hammerBefore: false },
  ]);
});
