import type {
  EventRecord,
  ScheduledGameRecord,
} from "@/lib/team-hierarchy-data";

export type GamesTab = "upcoming" | "events" | "single" | "past" | "unfinished";
export function groupGames(
  games: ScheduledGameRecord[],
  events: EventRecord[],
  now = Date.now(),
  broadcastingIds: ReadonlySet<string> = new Set(),
) {
  const chronological = [...games].sort((a, b) =>
    (a.scheduledStart ?? "9999").localeCompare(b.scheduledStart ?? "9999"),
  );
  const open = chronological.filter(
    (g) => g.status !== "completed" && g.status !== "closed",
  );
  const broadcasting = open.filter((g) => broadcastingIds.has(g.id));
  const upcoming = open.filter(
    (g) =>
      !broadcastingIds.has(g.id) &&
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
    upcoming,
    broadcasting,
    unfinished: open.filter(
      (g) =>
        !broadcastingIds.has(g.id) &&
        (!g.scheduledStart || new Date(g.scheduledStart).getTime() < now),
    ),
    completed: chronological.filter((g) => g.status === "completed").reverse(),
    closed: chronological.filter((g) => g.status === "closed").reverse(),
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
              g.status !== "closed" &&
              g.scheduledStart &&
              new Date(g.scheduledStart).getTime() >= now,
          ) ?? null,
      };
    }),
  };
}
