import type { CoachGame } from "./event";

export function coachingClosed(game: Pick<CoachGame, "status" | "state">) {
  return (
    game.status === "deleted" ||
    (["completed", "closed"].includes(game.status) && !game.state.reopened) ||
    game.state.status === "closed"
  );
}

/** Prefer the nearest playable start, including an upcoming draw before it begins.
 * Old active games are not evidence of a game still being played. */
export function scheduledCoachGame<
  T extends Pick<CoachGame, "status" | "state" | "scheduledStart">,
>(games: T[], now = Date.now()): T | undefined {
  const open = games.filter(
    (game) =>
      !["completed", "closed", "deleted"].includes(game.status) &&
      !coachingClosed(game),
  );
  const timed = open.filter(
    (game) =>
      game.scheduledStart && Number.isFinite(Date.parse(game.scheduledStart)),
  );
  const near = timed
    .filter((game) => {
      const delta = Date.parse(game.scheduledStart!) - now;
      return delta >= -4 * 3600000 && delta <= 3600000;
    })
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.scheduledStart!) - now) -
        Math.abs(Date.parse(b.scheduledStart!) - now),
    );
  const upcoming = timed
    .filter((game) => Date.parse(game.scheduledStart!) > now)
    .sort(
      (a, b) => Date.parse(a.scheduledStart!) - Date.parse(b.scheduledStart!),
    );
  return near[0] ?? upcoming[0] ?? open.find((game) => !game.scheduledStart);
}

export function coachingReadOnlyReason(
  game: CoachGame,
  games: CoachGame[],
  now = Date.now(),
) {
  if (coachingClosed(game))
    return "This game is closed. Scores and notes are available for review only.";
  if (game.state.reopened) return null;
  const next = scheduledCoachGame(games, now);
  if (
    next &&
    next.id !== game.id &&
    game.scheduledStart &&
    next.scheduledStart &&
    Date.parse(next.scheduledStart) > Date.parse(game.scheduledStart) &&
    Date.parse(next.scheduledStart) <= now + 3600000
  )
    return `A later game is due: ${next.label} vs ${next.opponent}. Select that game to score; this earlier game is available for review.`;
  return null;
}
