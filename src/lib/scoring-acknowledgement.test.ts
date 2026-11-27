import { expect, it } from "vitest";
import { scoringIntentMatches } from "./scoring-acknowledgement";
import type { ScoringAction } from "./scoring";
import type { ScoreEvent } from "./types";

const action: ScoringAction = {
  type: "score",
  intentId: "intent",
  expectedEnd: 2,
  expectedLastEventId: "previous",
  team: "home",
  points: 3,
  blank: false,
};
const event: ScoreEvent = {
  id: "intent",
  at: 1,
  type: "end",
  expectedLastEventId: "previous",
  score: { end: 2, team: "home", points: 3, blank: false },
};

it("requires the persisted intent, original end and original scoring payload", () => {
  expect(scoringIntentMatches([], action)).toBe(false);
  expect(scoringIntentMatches([event], action)).toBe(true);
  for (const score of [
    { ...event.score, end: 3 },
    { ...event.score, points: 1 },
    { ...event.score, team: "away" as const },
  ])
    expect(scoringIntentMatches([{ ...event, score }], action)).toBe(false);
  expect(
    scoringIntentMatches([{ ...event, expectedLastEventId: "other" }], action),
  ).toBe(false);
});

it("confirms the intent even if subsequent append-only events are present", () => {
  expect(
    scoringIntentMatches(
      [event, { id: "undo", at: 2, type: "undo", targetId: "intent" }],
      action,
    ),
  ).toBe(true);
});
