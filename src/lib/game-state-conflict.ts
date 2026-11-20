export class GameStateConflictError extends Error {
  constructor(message = "Game state update conflict") {
    super(message);
    this.name = "GameStateConflictError";
  }
}

export function isGameStateConflictError(
  error: unknown,
): error is GameStateConflictError {
  return error instanceof GameStateConflictError;
}

/** The original scoring intent no longer matches the append-only history. */
export class ScoringIntentConflictError extends GameStateConflictError {}

/** Bounded retries could not commit an otherwise valid scoring intent. */
export class ScoringWriteConflictError extends GameStateConflictError {}

export class GameClosedError extends Error {
  constructor(message = "This game is closed") {
    super(message);
    this.name = "GameClosedError";
  }
}
