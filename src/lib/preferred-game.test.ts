import { describe, it, expect } from "vitest";
import { isCurrentGame, preferredGame } from "./current-game";
const now = Date.parse("2026-09-19T18:00:00Z");
describe("current game selection", () => {
  it("keeps a started game current for its local day", () => {
    expect(isCurrentGame("2026-09-19T12:00:00Z", "America/Toronto", now)).toBe(
      true,
    );
    expect(isCurrentGame("2026-09-18T12:00:00Z", "America/Toronto", now)).toBe(
      false,
    );
    expect(isCurrentGame("2026-09-19T20:00:00Z", "America/Toronto", now)).toBe(
      false,
    );
    expect(
      isCurrentGame(
        "2026-09-19T23:30:00Z",
        "America/Toronto",
        Date.parse("2026-09-20T01:00:00Z"),
      ),
    ).toBe(true);
  });
  it("prefers today's open game then the next game, ignoring deleted/completed current games", () => {
    const past = {
      id: "past",
      status: "active",
      scheduledStart: "2026-09-17T12:00:00Z",
    };
    const current = {
      id: "current",
      status: "active",
      scheduledStart: "2026-09-19T12:00:00Z",
    };
    const next = {
      id: "next",
      status: "active",
      scheduledStart: "2026-09-20T12:00:00Z",
    };
    expect(preferredGame([past, next, current], now)?.id).toBe("current");
    expect(
      preferredGame([past, next, { ...current, status: "completed" }], now)?.id,
    ).toBe("next");
    expect(
      preferredGame([{ ...current, status: "deleted" }, past], now)?.id,
    ).toBe("past");
  });
});
