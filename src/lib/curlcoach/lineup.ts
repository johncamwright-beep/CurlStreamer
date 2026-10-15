import type { RosterEntry, Shot } from "./model";

export const throwingPositions = ["Lead", "Second", "Third", "Fourth"] as const;

/** Historical shot identity stays position/stone; these are the eight team rocks. */
export function rockNumber(shot: Pick<Shot, "position" | "stone">) {
  return throwingPositions.indexOf(shot.position) * 2 + shot.stone;
}

export function rockSlot(rock: number) {
  return {
    position: throwingPositions[Math.floor((rock - 1) / 2)],
    stone: ((rock - 1) % 2) + 1,
  };
}

export function defaultLineup(players: readonly RosterEntry[]): string[] {
  const standard = throwingPositions.map(
    (position) => players.find((player) => player.position === position)?.id,
  );
  if (standard.every((id): id is string => Boolean(id)))
    return standard.flatMap((id) => [id, id]);
  const positioned = players.filter((player) => player.position);
  const active = (positioned.length ? positioned : players).slice(0, 4);
  if (active.length === 0) return [];
  // Three-player suggestion: 3 + 3 + 2. Each rock remains independently editable.
  const counts =
    active.length === 3
      ? [3, 3, 2]
      : active.length === 2
        ? [4, 4]
        : active.length === 1
          ? [8]
          : [2, 2, 2, 2];
  return active.flatMap((player, index) =>
    Array<string>(counts[index]).fill(player.id),
  );
}

export function resolvedLineup(
  players: readonly RosterEntry[],
  saved?: readonly string[],
) {
  return saved?.length === 8 &&
    saved.every((id) => players.some((player) => player.id === id))
    ? [...saved]
    : defaultLineup(players);
}
