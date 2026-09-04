import { describe, expect, it } from "vitest";
import { groupGames } from "./game-hub";
import type { ScheduledGameRecord, EventRecord } from "./team-hierarchy-data";
const config = {
  eventName: "Single Game",
  homeName: "A",
  awayName: "B",
  homeColor: "#fff",
  awayColor: "#000",
  scheduledEnds: 8 as const,
  youtubeTitle: "A vs B",
  youtubeVisibility: "unlisted" as const,
};
const game = (
  id: string,
  start: string,
  eventId: string | null = null,
): ScheduledGameRecord => ({
  id,
  seasonId: "season",
  eventId,
  opponentId: "opp",
  scheduledStart: start,
  timezone: "UTC",
  gameNumber: null,
  gameLabel: null,
  createdAt: start,
  status: "active",
  config,
});
const event: EventRecord = {
  id: "event",
  seasonId: "season",
  name: "Slam",
  eventType: "tournament",
  startDate: "2026-09-01",
  endDate: "2026-09-03",
  location: null,
  timezone: "UTC",
  archivedAt: null,
};
describe("games hub grouping", () => {
  it("orders next games and separates events, season single games, and history", () => {
    const groups = groupGames(
      [
        game("later", "2026-09-03T00:00:00Z"),
        game("past", "2026-08-01T00:00:00Z"),
        game("event-game", "2026-09-02T00:00:00Z", "event"),
      ],
      [event],
      Date.parse("2026-09-01T00:00:00Z"),
    );
    expect(groups.nextUp.map((g) => g.id)).toEqual(["event-game", "later"]);
    expect(groups.singleGames.map((g) => g.id)).toEqual(["later"]);
    expect(groups.past.map((g) => g.id)).toEqual(["past"]);
    expect(groups.eventSummaries[0]).toMatchObject({
      gameCount: 1,
      nextGame: { id: "event-game" },
    });
  });
});
