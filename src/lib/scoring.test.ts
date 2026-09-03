import { describe, expect, it } from "vitest";
import { deriveScore } from "./scoring";
import type { GameConfig, ScoreEvent } from "./types";
const config: GameConfig = {
  eventName: "Test",
  homeName: "Home",
  awayName: "Away",
  homeColor: "#ff0000",
  awayColor: "#0000ff",
  scheduledEnds: 8,
  initialHammer: "home",
  youtubeTitle: "Test",
  youtubeVisibility: "unlisted",
};
const newGameConfig: GameConfig = { ...config };
delete newGameConfig.initialHammer;
const end = (
  id: string,
  team: "home" | "away" | null,
  points: number,
  blank = false,
): ScoreEvent => ({
  id,
  at: 1,
  type: "end",
  score: { end: +id, team, points, blank },
});
describe("curling scoring", () => {
  it("starts new games without hammer and preserves existing assignments", () => {
    expect(
      deriveScore({ config: newGameConfig, scoreEvents: [] }).hammer,
    ).toBeNull();
    expect(deriveScore({ config, scoreEvents: [] }).hammer).toBe("home");
  });

  it.each(["home", "away"] as const)(
    "uses a persisted %s initial hammer selection after refresh",
    (team) => {
      const events: ScoreEvent[] = [
        { id: "hammer", at: 1, type: "hammer", team },
      ];
      expect(
        deriveScore({ config: newGameConfig, scoreEvents: events }).hammer,
      ).toBe(team);
      expect(
        deriveScore({ config: newGameConfig, scoreEvents: [...events] }).hammer,
      ).toBe(team);
    },
  );
  it("transfers hammer after a score", () =>
    expect(
      deriveScore({ config, scoreEvents: [end("1", "home", 2)] }).hammer,
    ).toBe("away"));
  it("retains hammer after a blank", () =>
    expect(
      deriveScore({ config, scoreEvents: [end("1", null, 0, true)] }).hammer,
    ).toBe("home"));
  it("restores hammer when a scored end is undone", () => {
    const events: ScoreEvent[] = [
      { id: "h", at: 1, type: "hammer", team: "home" },
      end("1", "home", 2),
      { id: "u", at: 3, type: "undo", targetId: "1" },
    ];
    expect(
      deriveScore({ config: newGameConfig, scoreEvents: events }).hammer,
    ).toBe("home");
  });
  it("supports correction and auditable undo", () => {
    const events: ScoreEvent[] = [
      end("1", "home", 2),
      { id: "h", at: 2, type: "hammer", team: "home" },
      { id: "u", at: 3, type: "undo", targetId: "h" },
    ];
    const state = deriveScore({ config, scoreEvents: events });
    expect(state.hammer).toBe("away");
    expect(state.totals.home).toBe(2);
  });
});
