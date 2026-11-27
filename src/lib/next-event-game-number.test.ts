import { describe, expect, it } from "vitest";
import { nextEventGameNumber } from "./next-event-game-number";

describe("next event game number", () => {
  it("starts a new event at 1 and leaves standalone games unnumbered", () => {
    expect(nextEventGameNumber("event-a", [])).toBe("1");
    expect(nextEventGameNumber("", [])).toBe("");
  });
  it("continues the selected event without using another event's numbers", () => {
    expect(
      nextEventGameNumber("event-a", [
        { eventId: "event-a", gameNumber: 3 },
        { eventId: "event-a", gameNumber: 1 },
        { eventId: "event-a", gameNumber: null },
        { eventId: "event-b", gameNumber: 40 },
      ]),
    ).toBe("4");
  });
  it("includes newly saved and manually overridden numbers between page reads", () => {
    expect(
      nextEventGameNumber(
        "event-a",
        [{ eventId: "event-a", gameNumber: 2 }],
        ["event-a:3", "event-a:7", "event-b:100"],
      ),
    ).toBe("8");
  });
});
