import { describe, expect, it } from "vitest";
import { gameEntryCapabilities, gameEntryPresentation } from "./game-entry";
const config = {
  eventName: "Club final — Game 3",
  homeName: "Rocks",
  awayName: "Stones",
};
describe("game entry context", () => {
  it("retains repeated matchup identity and uses the scheduled timezone", () => {
    const value = gameEntryPresentation(config, {
      state: "available",
      scheduledStart: "2026-10-20T22:30:00Z",
      timezone: "America/Toronto",
      gameNumber: 3,
    });
    expect(value.title).toBe("Rocks vs Stones — Club final · Game 3");
    expect(value.scheduledLabel).toContain("6:30 PM");
    expect(value.scheduledLabel).toContain("America/Toronto");
  });
  it("distinguishes unavailable metadata from an explicitly unscheduled game", () => {
    expect(gameEntryPresentation(config).scheduledLabel).toBe(
      "Schedule unavailable",
    );
    expect(
      gameEntryPresentation(config, {
        state: "available",
        scheduledStart: null,
        timezone: null,
        gameNumber: null,
      }).scheduledLabel,
    ).toBe("Unscheduled");
    expect(
      gameEntryPresentation(config, {
        state: "available",
        scheduledStart: "bad",
        timezone: "bad",
        gameNumber: null,
      }).scheduledLabel,
    ).toBe("Schedule unavailable");
  });
  it("does not give camera or viewer identities scorer controls", () => {
    expect(gameEntryCapabilities("viewer", false, false, false)).toMatchObject({
      scoring: false,
      broadcast: false,
      editSchedule: false,
    });
    expect(gameEntryCapabilities("", false, false, false).scoring).toBe(false);
    expect(gameEntryCapabilities("", false, true, false)).toMatchObject({
      scoring: true,
      editSchedule: false,
    });
    expect(gameEntryCapabilities("owner", false, false, true)).toMatchObject({
      scoring: false,
      assignOpponent: true,
    });
    expect(
      gameEntryCapabilities("game_operator", false, false, false),
    ).toMatchObject({
      control: true,
      scoring: true,
      broadcast: true,
      editSchedule: true,
    });
  });
});
