import type { EndScore, GameState, ScoreEvent, Team } from "./types";
import { GameStateConflictError } from "./game-state-conflict";

export type ScoringAction =
  | {
      type: "score";
      intentId: string;
      expectedEnd: number;
      expectedLastEventId: string | null;
      team: Team | null;
      points: number;
      blank: boolean;
    }
  | {
      type: "hammer";
      intentId: string;
      expectedEnd: number;
      expectedLastEventId: string | null;
      team: Team;
    }
  | {
      type: "undo";
      intentId: string;
      expectedLastEventId: string | null;
      expectedTargetId: string;
    };

export function activeEvents(events: ScoreEvent[]) {
  const undone = new Set(
    events.filter((e) => e.type === "undo").map((e) => e.targetId),
  );
  return events.filter((e) => e.type !== "undo" && !undone.has(e.id));
}
export function deriveScore(game: Pick<GameState, "config" | "scoreEvents">) {
  let hammer: Team | null = game.config.initialHammer ?? null;
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

function intentMatches(event: ScoreEvent, action: ScoringAction) {
  if (action.type === "score")
    return (
      event.type === "end" &&
      event.score.end === action.expectedEnd &&
      event.score.team === action.team &&
      event.score.points === action.points &&
      event.score.blank === action.blank &&
      (event.expectedLastEventId ?? null) === action.expectedLastEventId
    );
  if (action.type === "hammer")
    return (
      event.type === "hammer" &&
      event.team === action.team &&
      event.expectedEnd === action.expectedEnd &&
      (event.expectedLastEventId ?? null) === action.expectedLastEventId
    );
  return (
    event.type === "undo" &&
    event.targetId === action.expectedTargetId &&
    (event.expectedLastEventId ?? null) === action.expectedLastEventId
  );
}

/** Apply one position-bound, idempotent scoring intent to append-only history. */
export function applyScoringAction(
  game: GameState,
  action: ScoringAction,
  at = Date.now(),
): { event?: ScoreEvent; idempotent: boolean } {
  const existing = game.scoreEvents.find(
    (event) => event.id === action.intentId,
  );
  if (existing) {
    if (!intentMatches(existing, action))
      throw new GameStateConflictError("Scoring intent was already used");
    return { idempotent: true };
  }

  const lastEventId = game.scoreEvents.at(-1)?.id ?? null;
  if (lastEventId !== action.expectedLastEventId)
    throw new GameStateConflictError("Scoring history position changed");

  if (action.type === "undo") {
    const target = activeEvents(game.scoreEvents).at(-1);
    if (!target || target.id !== action.expectedTargetId)
      throw new GameStateConflictError("Scoring history changed before Undo");
    const event: ScoreEvent = {
      id: action.intentId,
      at,
      type: "undo",
      targetId: target.id,
      expectedLastEventId: action.expectedLastEventId,
    };
    game.scoreEvents.push(event);
    return { event, idempotent: false };
  }

  const score = deriveScore(game);
  if (score.currentEnd !== action.expectedEnd)
    throw new GameStateConflictError("Scoring position changed");
  if (action.type === "score") {
    if (!score.hammer)
      throw new Error("Hammer must be selected before scoring");
    const event: ScoreEvent = {
      id: action.intentId,
      at,
      type: "end",
      score: {
        end: action.expectedEnd,
        team: action.team,
        points: action.points,
        blank: action.blank,
      },
      expectedLastEventId: action.expectedLastEventId,
    };
    game.scoreEvents.push(event);
    return { event, idempotent: false };
  }

  const event: ScoreEvent = {
    id: action.intentId,
    at,
    type: "hammer",
    team: action.team,
    expectedEnd: action.expectedEnd,
    expectedLastEventId: action.expectedLastEventId,
  };
  game.scoreEvents.push(event);
  return { event, idempotent: false };
}
