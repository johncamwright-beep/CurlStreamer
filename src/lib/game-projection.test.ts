import { describe, expect, it } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "./game-projection";

describe("broadcast game projection", () => {
  it("includes only the server-derived broadcast schedule fields", () => {
    const game = gameFixture();
    game.broadcastSchedule = {
      scheduledStart: "2026-10-20T22:30:00Z",
      timezone: "America/Toronto",
    };

    expect(broadcastGame(game).broadcastSchedule).toEqual({
      scheduledStart: "2026-10-20T22:30:00Z",
      timezone: "America/Toronto",
    });
  });
});
