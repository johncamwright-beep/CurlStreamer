import { describe, it, expect } from "vitest";
import { gameFixture } from "@/test/game-fixture";
import {
  applyCelebrationAction,
  currentCelebration,
} from "./celebration-state";
import { actionSchema } from "./schema";
import { broadcastGame } from "./game-projection";
const action = {
  type: "celebration-play" as const,
  triggerId: "e0d16331-e641-4e3e-a453-adc6ba25eabb",
  templateId: "lightsaber" as const,
  playerId: "roster-1",
  headshotUrl: "https://storage.invalid/prepared.png?token=short",
  volume: 0.6,
  muted: false,
};
describe("durable celebration intent", () => {
  it("is idempotent, scheduled, bounded, and leaves game controls and scoring unchanged", () => {
    const game = gameFixture();
    const before = structuredClone(game);
    applyCelebrationAction(game, action, 1000);
    applyCelebrationAction(game, action, 1100);
    expect(game.celebrationEvents).toHaveLength(1);
    const cue = currentCelebration(game, 1100)!;
    expect(cue.startedAt).toBe(6000);
    expect(cue.expiresAt).toBe(12167);
    expect(currentCelebration(game, 12167)).toBeUndefined();
    expect({ ...game, celebrationEvents: undefined }).toEqual({
      ...before,
      celebrationEvents: undefined,
    });
    applyCelebrationAction(
      game,
      {
        type: "celebration-stop",
        triggerId: "d0d16331-e641-4e3e-a453-adc6ba25eabb",
      },
      3600,
    );
    expect(currentCelebration(game, 3600)).toBeUndefined();
    expect(game.celebrationEvents).toHaveLength(2);
    expect(game.scoreEvents).toEqual(before.scoreEvents);
  });
  it("schedules Cat Dance for its full clip duration", () => {
    const game = gameFixture();
    const catAction = { ...action, templateId: "cat-dance" as const };
    expect(actionSchema.safeParse(catAction).success).toBe(true);
    applyCelebrationAction(game, catAction, 1000);
    expect(currentCelebration(game, 6000)).toMatchObject({
      templateId: "cat-dance",
      startedAt: 6000,
      expiresAt: 15700,
    });
    expect(currentCelebration(game, 15699)?.templateId).toBe("cat-dance");
    expect(currentCelebration(game, 15700)).toBeUndefined();
  });
  it("validates templates, gain, finite numbers and trigger identity", () => {
    expect(actionSchema.safeParse(action).success).toBe(true);
    for (const invalid of [
      { templateId: "unknown" },
      { volume: 2 },
      { volume: NaN },
      { triggerId: "old" },
    ])
      expect(actionSchema.safeParse({ ...action, ...invalid }).success).toBe(
        false,
      );
  });
  it("projects only the current cue's render allowlist", () => {
    const game = gameFixture();
    applyCelebrationAction(game, action, Date.now());
    const latest = game.celebrationEvents![0];
    if (latest.type !== "play") throw Error();
    Object.assign(latest.cue, {
      storage_path: "secret-private-object",
      organizationId: "secret",
    });
    const projected = broadcastGame(game);
    expect(projected.celebration?.id).toBe(action.triggerId);
    expect(JSON.stringify(projected)).not.toContain("secret");
    expect(projected).not.toHaveProperty("celebrationEvents");
  });
});
