import { describe, expect, it } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import { broadcastGame } from "./game-projection";

describe("broadcast game projection", () => {
  it("distinguishes explicit celebration Stop from natural cue expiry", () => {
    const game = gameFixture();
    const cue = {
      id: "play",
      templateId: "cat-dance" as const,
      playerId: "player",
      playerName: "Sam",
      startedAt: 1,
      expiresAt: 9701,
      volume: 0.6,
      muted: false,
    };
    game.celebrationEvents = [{ type: "play", cue }];
    expect(broadcastGame(game).celebration).toBeUndefined();
    expect(broadcastGame(game).celebrationStopped).toBeUndefined();
    game.celebrationEvents.push({ type: "stop", id: "stop", at: 2 });
    expect(broadcastGame(game).celebrationStopped).toBe(true);
    game.celebrationEvents.push({
      type: "play",
      cue: {
        ...cue,
        id: "next",
        startedAt: Date.now(),
        expiresAt: Date.now() + 9700,
      },
    });
    expect(broadcastGame(game).celebrationStopped).toBeUndefined();
  });
  it("sends the default sync adjustment to installed renderers and preserves a saved zero", () => {
    const game = gameFixture();
    expect(broadcastGame(game).programAudioDelayMs).toBe(2750);
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
