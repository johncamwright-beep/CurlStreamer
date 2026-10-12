import { describe, expect, it } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "./game-projection";

describe("broadcast game projection", () => {
  it("sends the default sync adjustment to installed renderers and preserves a saved zero", () => {
    const game = gameFixture();
    expect(broadcastGame(game).programAudioDelayMs).toBe(-1500);
    game.programAudioDelayMs = 0;
    expect(broadcastGame(game).programAudioDelayMs).toBe(0);
    game.programAudioDelayMs = 750;
    expect(broadcastGame(game).programAudioDelayMs).toBe(750);
  });
  it("does not expose native intent or enable an unclaimed phone microphone", () => {
    const game = gameFixture();
    game.claims = {};
    game.cameraAudio = {
      "camera-home": {
        enabled: true,
        generation: 0,
        status: "pending",
        updatedAt: 1,
      },
    };
    const projection = broadcastGame(game);
    expect(projection.cameraAudio?.["camera-home"]?.enabled).toBe(false);
    expect(projection).not.toHaveProperty("nativeCameraAudio");
  });
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
