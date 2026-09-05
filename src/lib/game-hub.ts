import type {
  EventRecord,
  ScheduledGameRecord,
} from "@/lib/team-hierarchy-data";

export type GamesTab = "events" | "single" | "past";
export function groupGames(
  games: ScheduledGameRecord[],
  events: EventRecord[],
  now = Date.now(),
) {
  const chronological = [...games].sort((a, b) =>
    (a.scheduledStart ?? "9999").localeCompare(b.scheduledStart ?? "9999"),
  );
  const upcoming = chronological.filter(
    (g) =>
      g.status !== "completed" &&
      g.scheduledStart &&
      new Date(g.scheduledStart).getTime() >= now,
  );
  const past = chronological
    .filter(
      (g) =>
        g.status === "completed" ||
        (g.scheduledStart && new Date(g.scheduledStart).getTime() < now),
    )
    .reverse();
  return {
    nextUp: upcoming.slice(0, 5),
    singleGames: upcoming.filter((g) => Boolean(g.seasonId) && !g.eventId),
    past,
    eventSummaries: events.map((event) => {
      const eventGames = chronological.filter((g) => g.eventId === event.id);
      return {
        event,
        gameCount: eventGames.length,
        nextGame:
          eventGames.find(
            (g) =>
              g.status !== "completed" &&
              g.scheduledStart &&
              new Date(g.scheduledStart).getTime() >= now,
          ) ?? null,
      };
    }),
  };
}
