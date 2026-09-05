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
