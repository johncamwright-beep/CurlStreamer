import { describe, expect, it } from "vitest";
import {
  eventInputSchema,
  isIanaTimezone,
  localDateTimeToUtc,
  formatScheduledStart,
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

  it.each([
    "tournament",
    "bonspiel",
    "league",
    "playoff",
    "exhibition",
    "other",
  ])("supports %s events", (eventType) => {
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
  });

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
      seasonId: crypto.randomUUID(),
      eventId: crypto.randomUUID(),
      opponentId: crypto.randomUUID(),
      scheduledStart: "2026-10-01T18:30:00-07:00",
      timezone: "America/Phoenix",
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

  it("allows a season-only game with a TBD opponent and no game number", () => {
    expect(
      scheduledGameInputSchema.safeParse({
        seasonId: crypto.randomUUID(),
        eventId: null,
        opponentId: null,
        scheduledStart: "2026-10-02T01:30:00.000Z",
        timezone: "America/Toronto",
        gameNumber: null,
      }).success,
    ).toBe(true);
  });

  it("converts an event wall-clock time to UTC and displays it in that zone", () => {
    const instant = localDateTimeToUtc(
      "2026-12-05",
      "19:30",
      "America/Toronto",
    );
    expect(instant).toBe("2026-12-06T00:30:00.000Z");
    expect(formatScheduledStart(instant!, "America/Toronto")).toMatch(
      /Dec 5, 2026.*7:30.*EST/,
    );
  });

  it("rejects a nonexistent daylight-saving wall-clock time", () => {
    expect(
      localDateTimeToUtc("2026-03-08", "02:30", "America/Toronto"),
    ).toBeNull();
  });
});
