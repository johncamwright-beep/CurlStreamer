import type { ScoreEvent } from "./types";
import type { ScoringAction } from "./scoring";

/** An HTTP success alone does not confirm that this scoring intent persisted. */
export function scoringIntentMatches(events: ScoreEvent[], value: unknown) {
  const action = value as ScoringAction | undefined;
  if (!action || !["score", "hammer", "undo"].includes(action.type))
    return true;
  const event = events.find((candidate) => candidate.id === action.intentId);
  if (
    !event ||
    (event.expectedLastEventId ?? null) !== action.expectedLastEventId
  )
    return false;
  if (action.type === "score")
    return (
      event.type === "end" &&
      event.score.end === action.expectedEnd &&
      event.score.team === action.team &&
      event.score.points === action.points &&
      event.score.blank === action.blank
    );
  if (action.type === "hammer")
    return (
      event.type === "hammer" &&
      event.team === action.team &&
      event.expectedEnd === action.expectedEnd
    );
  return event.type === "undo" && event.targetId === action.expectedTargetId;
}
