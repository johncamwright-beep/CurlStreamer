import { expect, it } from "vitest";
import {
  append,
  currentShots,
  emptyState,
  shotSchema,
  type Shot,
} from "./model";
import { nextTurn } from "./next-turn";
import { technicalSummary } from "./technical";
import { sampleEvent } from "./event";
import { reportInputs } from "./reports";

const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: null,
  execution: "Make",
  grade: 5,
  deficiency: null,
  review: null,
  excluded: null,
  note: "",
};
it("accepts legacy shots, validates observations and clears them for the next turn", () => {
  expect(shotSchema.parse(shot)).toEqual(shot);
  const observed: Shot = {
    ...shot,
    line: "Wide",
    release: "Dump",
    technical: "Understep",
  };
  expect(shotSchema.parse(observed)).toEqual(observed);
  for (const field of ["line", "release", "technical"])
    expect(
      shotSchema.safeParse({ ...shot, [field]: "arbitrary" }).success,
    ).toBe(false);
  const next = nextTurn(observed, []);
  for (const field of ["line", "release", "technical"] as const)
    expect(next?.[field] ?? null).toBeNull();
});
it("keeps corrections and removal append-only without dropping delivery observations", () => {
  const id = crypto.randomUUID();
  const first = append(
    emptyState(),
    {
      requestId: crypto.randomUUID(),
      shotId: id,
      expectedRevision: 0,
      shot: { ...shot, line: "Wide" },
    },
    "coach",
  );
  const corrected = append(
    first,
    {
      requestId: crypto.randomUUID(),
      shotId: id,
      expectedRevision: 1,
      shot: { ...shot, line: "Tight", technical: "Fishtail" },
    },
    "coach",
  );
  expect(corrected.events[0].shot?.line).toBe("Wide");
  expect(currentShots(corrected.events)[0].technical).toBe("Fishtail");
  const removed = append(
    corrected,
    {
      requestId: crypto.randomUUID(),
      shotId: id,
      expectedRevision: 2,
      shot: null,
    },
    "coach",
  );
  expect(currentShots(removed.events)).toEqual([]);
  expect(removed.events).toHaveLength(3);
});
it("separates unknown, field-specific coverage, excluded shots, grades and miss denominators", () => {
  const result = technicalSummary([
    shot,
    { ...shot, line: "Wide", release: "Soft", grade: 0, execution: "Xmiss" },
    { ...shot, line: "Wide", grade: null, execution: null },
    { ...shot, line: "On broom", technical: "Understep" },
    {
      ...shot,
      line: "Tight",
      technical: "Overstep",
      excluded: "Pick",
      grade: null,
    },
  ]);
  expect(result[0]).toMatchObject({ total: 4, recorded: 3, unrecorded: 1 });
  expect(result[0].rows[1]).toMatchObject({
    count: 2,
    classified: 1,
    misses: 1,
    missPercent: 100,
    shooting: 0,
    graded: 1,
  });
  expect(result[0].rows[1].percent).toBeCloseTo(200 / 3);
  expect(result[1].recorded).toBe(1);
  expect(result[2].recorded).toBe(1);
  expect(technicalSummary([shot])[0].rows[0].percent).toBeNull();
});
it("limits individual technical evidence to the athlete and the matching game", () => {
  const event = sampleEvent("shorty-example");
  event.games = event.games.slice(0, 2);
  for (const game of event.games) {
    game.state.roster = [
      { id: "lead", name: "Alex", position: "Lead" },
      { id: "second", name: "Blair", position: "Second" },
    ];
    game.state.events = [];
  }
  event.games[0].state.events = [
    {
      requestId: crypto.randomUUID(),
      shotId: crypto.randomUUID(),
      expectedRevision: 0,
      revision: 1,
      actor: "coach",
      at: new Date().toISOString(),
      shot: { ...shot, line: "Wide", technical: "Understep" },
    },
    {
      requestId: crypto.randomUUID(),
      shotId: crypto.randomUUID(),
      expectedRevision: 1,
      revision: 2,
      actor: "coach",
      at: new Date().toISOString(),
      shot: { ...shot, playerId: "second", line: "Tight", release: "Pop" },
    },
  ];
  const input = reportInputs(event, "players")[0];
  expect(input.technical?.[0].rows[1].count).toBe(1);
  expect(input.technical?.[1].recorded).toBe(0);
  expect(
    input.evidence.find((e) => e.id === "technical-line-1-share")?.basis,
  ).toEqual({ numerator: 1, denominator: 1, unit: "shots" });
  expect(input.evidence.some((e) => e.id.startsWith("game-1-technical"))).toBe(
    true,
  );
  expect(input.evidence.some((e) => e.id.startsWith("game-2-technical"))).toBe(
    false,
  );
  expect(reportInputs(event, "team")[0].technical).toBeUndefined();
});
