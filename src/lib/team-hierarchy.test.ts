import { describe, expect, it } from "vitest";
import {
  eventInputSchema,
  isIanaTimezone,
  normalizeOpponentName,
  scheduledGameInputSchema,
  seasonInputSchema,
} from "./team-hierarchy";

describe("team hierarchy validation", () => {
  it("trims season names and validates date ranges", () => {
    expect(
      seasonInputSchema.parse({
        name: " 2026–27 ",
        startDate: "2026-09-01",
        endDate: "2027-04-30",
      }).name,
    ).toBe("2026–27");
    expect(
      seasonInputSchema.safeParse({
        name: " ",
        startDate: "2027-01-02",
        endDate: "2027-01-01",
      }).success,
    ).toBe(false);
  });

  it.each(["tournament", "bonspiel", "league", "exhibition", "other"])(
    "supports %s events",
    (eventType) => {
      expect(
        eventInputSchema.safeParse({
          seasonId: "d9428888-122b-4f22-93b0-2dd424213a31",
          name: "Event",
          eventType,
          startDate: "2026-10-01",
          endDate: "2026-10-02",
          timezone: "America/Phoenix",
        }).success,
      ).toBe(true);
    },
  );

  it("rejects invalid event ranges, types, and timezones", () => {
    expect(isIanaTimezone("America/Toronto")).toBe(true);
    expect(isIanaTimezone("Not/A_Zone")).toBe(false);
    expect(
      eventInputSchema.safeParse({
        seasonId: crypto.randomUUID(),
        name: "Event",
        eventType: "curling-only",
        startDate: "2026-10-02",
        endDate: "2026-10-01",
        timezone: "Not/A_Zone",
      }).success,
    ).toBe(false);
  });

  it("normalizes opponent case and runs of whitespace", () => {
    expect(normalizeOpponentName("  GRANITE   Club ")).toBe("granite club");
  });

  it("requires a positive game number and offset timestamp", () => {
    const base = {
      eventId: crypto.randomUUID(),
      opponentId: crypto.randomUUID(),
      scheduledStart: "2026-10-01T18:30:00-07:00",
    };
    expect(
      scheduledGameInputSchema.safeParse({ ...base, gameNumber: 1 }).success,
    ).toBe(true);
    expect(
      scheduledGameInputSchema.safeParse({ ...base, gameNumber: 0 }).success,
    ).toBe(false);
    expect(
      scheduledGameInputSchema.safeParse({
        ...base,
        gameNumber: 1,
        scheduledStart: "tomorrow",
      }).success,
    ).toBe(false);
  });
});
