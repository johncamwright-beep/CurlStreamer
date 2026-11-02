import { describe, expect, it } from "vitest";
import { gamePollDelay } from "./game-polling";

describe("game polling cadence", () => {
  const active = {
    lifecycle: "active" as const,
    error: "",
    hidden: false,
    keepLiveWhenHidden: false,
  };
  it("keeps visible scoring fast and reduces idle background reads", () => {
    expect(gamePollDelay(active)).toBe(2000);
    expect(gamePollDelay({ ...active, hidden: true })).toBe(15000);
    expect(
      gamePollDelay({ ...active, hidden: true, keepLiveWhenHidden: true }),
    ).toBe(2000);
  });
  it("backs off failures and terminal games without permanently losing updates", () => {
    expect(gamePollDelay({ ...active, error: "Unavailable" })).toBe(10000);
    for (const lifecycle of ["completed", "closed", "deleted"] as const)
      expect(
        gamePollDelay({ ...active, lifecycle, keepLiveWhenHidden: true }),
      ).toBe(30000);
  });
});
