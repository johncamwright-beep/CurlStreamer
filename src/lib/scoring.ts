import type { EndScore, GameState, ScoreEvent, Team } from "./types";

export function activeEvents(events: ScoreEvent[]) {
  const undone = new Set(
    events.filter((e) => e.type === "undo").map((e) => e.targetId),
  );
  return events.filter((e) => e.type !== "undo" && !undone.has(e.id));
}
export function deriveScore(game: Pick<GameState, "config" | "scoreEvents">) {
  let hammer: Team = game.config.initialHammer;
  const ends: EndScore[] = [];
  for (const event of activeEvents(game.scoreEvents)) {
    if (event.type === "hammer") hammer = event.team;
    if (event.type === "end") {
      ends.push(event.score);
      if (!event.score.blank && event.score.team)
        hammer = event.score.team === "home" ? "away" : "home";
    }
  }
  return {
    ends,
    hammer,
    totals: {
      home: ends.reduce((n, e) => n + (e.team === "home" ? e.points : 0), 0),
      away: ends.reduce((n, e) => n + (e.team === "away" ? e.points : 0), 0),
    },
    currentEnd: Math.min(ends.length + 1, game.config.scheduledEnds),
  };
}
