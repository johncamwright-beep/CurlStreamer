import { expect, it } from "vitest";
import { sampleEvent } from "./event";
import { coachingReadOnlyReason, scheduledCoachGame } from "./game-selection";
const base = sampleEvent("shorty-example").games[0];
const morning = {
  ...base,
  id: "morning",
  status: "active",
  state: { ...base.state, status: "open" as const },
  scheduledStart: "2026-10-03T15:15:00Z",
};
const evening = {
  ...morning,
  id: "evening",
  label: "Game 4",
  scheduledStart: "2026-10-03T21:15:00Z",
};
it("selects the approaching draw over the earlier still-active game", () => {
  const now = Date.parse("2026-10-03T21:00:00Z");
  expect(scheduledCoachGame([morning, evening], now)?.id).toBe("evening");
  expect(coachingReadOnlyReason(morning, [morning, evening], now)).toContain(
    "Game 4",
  );
  expect(coachingReadOnlyReason(evening, [morning, evening], now)).toBeNull();
});
it("never recommends a privately finished or shared completed game", () => {
  const now = Date.parse("2026-10-03T21:00:00Z");
  expect(
    scheduledCoachGame(
      [{ ...evening, state: { ...evening.state, status: "closed" } }],
      now,
    ),
  ).toBeUndefined();
  expect(
    scheduledCoachGame([{ ...evening, status: "completed" }], now),
  ).toBeUndefined();
  expect(
    coachingReadOnlyReason({ ...morning, status: "completed" }, [], now),
  ).toContain("closed");
});
it("keeps the current draw near its start, handles explicit timezone offsets, and does not recommend old games", () => {
  expect(
    scheduledCoachGame(
      [morning, evening],
      Date.parse("2026-10-03T11:30:00-04:00"),
    )?.id,
  ).toBe("morning");
  expect(
    scheduledCoachGame([morning], Date.parse("2026-10-04T15:15:00Z")),
  ).toBeUndefined();
});
