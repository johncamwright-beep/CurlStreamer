import type { CoachGame } from "./event";

export type EndObservation = {
  end: number;
  us: number;
  them: number;
  hammer: boolean | null;
  difference: number | null;
};
/** Hammer belongs to the start of an end; saved line scores also carry the next end's hammer. */
export function observedEnds(game: CoachGame): EndObservation[] {
  let hammer: boolean | null =
    game.initialHammer === null ? null : game.initialHammer === game.side;
  let difference: number | null = 0;
  let previous = 0;
  return [...game.ends]
    .sort((a, b) => a.end - b.end)
    .map((end) => {
      if (end.end !== previous + 1) {
        hammer = null;
        difference = null;
      }
      const observation = {
        end: end.end,
        us: end.us,
        them: end.them,
        hammer: end.hammerBefore !== undefined ? end.hammerBefore : hammer,
        difference,
      };
      hammer = end.hammer;
      if (difference !== null) difference += end.us - end.them;
      previous = end.end;
      return observation;
    });
}
export function rate(count: number, total: number) {
  return { count, total, percent: total ? (count / total) * 100 : null };
}
export function teamScoreStatistics(games: CoachGame[], opponent = false) {
  const ends = games
    .filter((g) => g.scoreboardAvailable)
    .flatMap(observedEnds)
    .map((end) =>
      opponent
        ? {
            ...end,
            us: end.them,
            them: end.us,
            hammer: end.hammer === null ? null : !end.hammer,
          }
        : end,
    );
  const withHammer = ends.filter((e) => e.hammer === true);
  const withoutHammer = ends.filter((e) => e.hammer === false);
  const count = (
    rows: EndObservation[],
    match: (e: EndObservation) => boolean,
  ) => rate(rows.filter(match).length, rows.length);
  return {
    unknownHammer: ends.filter((e) => e.hammer === null).length,
    scoring: count(withHammer, (e) => e.us > 0),
    multiple: count(withHammer, (e) => e.us >= 2),
    stolenAgainst: count(withHammer, (e) => e.them > 0),
    blankWith: count(withHammer, (e) => e.us === 0 && e.them === 0),
    steals: count(withoutHammer, (e) => e.us > 0),
    forceOne: count(withoutHammer, (e) => e.them === 1),
    concedeMultiple: count(withoutHammer, (e) => e.them >= 2),
    blankWithout: count(withoutHammer, (e) => e.us === 0 && e.them === 0),
    blanks: count(ends, (e) => e.us === 0 && e.them === 0),
  };
}
export function situationWins(
  games: CoachGame[],
  enteringEnd: "final" | number,
) {
  const groups = new Map<
    string,
    {
      difference: number;
      hammer: boolean;
      wins: number;
      losses: number;
      ties: number;
    }
  >();
  for (const game of games) {
    if (!game.scoreboardAvailable || game.status !== "completed") continue;
    const ends = observedEnds(game);
    // Do not infer a final result from an incomplete line score.
    if (!ends.length || ends.some((e) => e.difference === null)) continue;
    const start = ends.find(
      (e) =>
        e.end === (enteringEnd === "final" ? game.scheduledEnds : enteringEnd),
    );
    if (!start || start.hammer === null || start.difference === null) continue;
    const difference = Math.max(-4, Math.min(4, start.difference));
    const key = difference + ":" + start.hammer;
    const group = groups.get(key) ?? {
      difference,
      hammer: start.hammer,
      wins: 0,
      losses: 0,
      ties: 0,
    };
    const final = ends.reduce((sum, e) => sum + e.us - e.them, 0);
    if (final > 0) group.wins++;
    else if (final < 0) group.losses++;
    else group.ties++;
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.difference - a.difference || Number(b.hammer) - Number(a.hammer),
    )
    .map((group) => ({
      ...group,
      ...rate(group.wins, group.wins + group.losses + group.ties),
    }));
}
