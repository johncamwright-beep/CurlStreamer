import { describe, expect, it } from "vitest";
import {
  formatCanonicalGameTitle,
  formatYouTubeScheduledTitle,
} from "./game-title";

describe("scheduled game titles", () => {
  it("formats event and single games without scheduling metadata", () => {
    expect(
      formatCanonicalGameTitle({
        homeName: "Team 1",
        awayName: "Team 2",
        eventName: "Event Name",
      }),
    ).toBe("Team 1 vs Team 2 — Event Name");
    expect(
      formatCanonicalGameTitle({ homeName: "Team 1", awayName: "Team 2" }),
    ).toBe("Team 1 vs Team 2");
  });
  it("uses TBD and normalizes whitespace", () => {
    expect(
      formatCanonicalGameTitle({
        homeName: "  Team   1 ",
        awayName: "Opponent TBD",
        eventName: " Event   Name ",
      }),
    ).toBe("Team 1 vs TBD — Event Name");
  });
  it("uses snapshots and excludes labels, numbers, and event types", () => {
    expect(
      formatCanonicalGameTitle({
        homeName: "Saved Team",
        awayName: "Saved Opponent",
        eventName: "Saved Event",
        ...({
          gameLabel: "Final",
          gameNumber: 7,
          eventType: "playoff",
        } as object),
      }),
    ).toBe("Saved Team vs Saved Opponent — Saved Event");
  });
  it("preserves meaningful legacy titles", () => {
    expect(
      formatCanonicalGameTitle({
        structured: false,
        legacyTitle: "  Historic   Final ",
        homeName: "A",
        awayName: "B",
      }),
    ).toBe("Historic Final");
  });
  it("creates timezone-aware future YouTube titles and safely falls back", () => {
    expect(
      formatYouTubeScheduledTitle(
        "A vs B — Final",
        "2026-01-16T02:30:00.000Z",
        "America/Edmonton",
      ),
    ).toBe("A vs B — Final — Jan 15, 2026, 7:30 PM America/Edmonton");
    expect(
      formatYouTubeScheduledTitle("A vs B", "invalid", "America/Edmonton"),
    ).toBe("A vs B");
    expect(
      formatYouTubeScheduledTitle(
        "A vs B",
        "2026-01-16T02:30:00.000Z",
        "Invalid/Zone",
      ),
    ).toBe("A vs B");
  });
});
