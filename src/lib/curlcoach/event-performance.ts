import { analysisEventShots, type AnalysisShot } from "./advanced-analysis";
import { report, shotTypes } from "./model";
import type { CoachEvent, Workspace } from "./event";
import type { Evidence } from "./reports";

export const BASELINE_EVENTS = 5;
export const MIN_BASELINE_SHOTS = 5;
export type PerformanceMeasure = {
  percent: number | null;
  graded: number;
};
export type BaselineMetrics = {
  routinePercent: number | null;
  routineShots: number;
  matchedRoutineShots: number;
  matchedRoutinePercent: number | null;
  expectedRoutinePercent: number | null;
  baselineGap: number | null;
  routineMakeRate: number | null;
  ratedShots: number;
  gradedShots: number;
  averageDifficulty: number | null;
  baselineDifficulty: number | null;
  difficultyIndex: number | null;
  difficultShare: number | null;
  baselineDifficultShare: number | null;
  baselineRatedShots: number;
};
export type EventPerformancePoint = BaselineMetrics &
  PerformanceMeasure & {
    id: string;
    name: string;
    date: string | null;
    complete: boolean;
    baselineEvents: number;
    byType: Record<string, PerformanceMeasure>;
    bySubtype: Record<string, PerformanceMeasure>;
    games: (BaselineMetrics & { id: string; name: string })[];
  };
export type EventPerformance = {
  points: EventPerformancePoint[];
  currentEventId?: string;
};

/** Uses the authorized season workspace already loaded by analytics. */
export function splitPerformanceEvents(
  event: CoachEvent,
  catalog: Workspace["catalog"],
): CoachEvent[] {
  return catalog
    .filter((entry) => entry.seasonId === event.seasonId)
    .map((entry) => ({
      ...event,
      id: entry.id,
      name: entry.name,
      startDate: entry.startDate,
      performanceHistory: undefined,
      games: event.games.filter(
        (game) => game.eventId === entry.id && game.status !== "deleted",
      ),
    }))
    .filter((entry) => entry.games.length > 0);
}
const eligible = (shot: AnalysisShot) => !shot.excluded && shot.grade !== null;
const measure = (shots: AnalysisShot[]): PerformanceMeasure => {
  const result = report(shots);
  return { percent: result.percent, graded: result.scored };
};
const weight = { A: 1, B: 2, C: 3 };
const rated = (shots: AnalysisShot[]) =>
  shots.filter((s) => eligible(s) && s.difficulty !== undefined);
const average = (shots: AnalysisShot[]) =>
  shots.length
    ? shots.reduce((sum, s) => sum + weight[s.difficulty!], 0) / shots.length
    : null;
const difficult = (shots: AnalysisShot[]) =>
  shots.length
    ? (100 * shots.filter((s) => s.difficulty === "C").length) / shots.length
    : null;
const matchKey = (s: AnalysisShot) =>
  s.shotSubtype && s.type
    ? JSON.stringify([s.playerId, s.type, s.shotSubtype])
    : null;

export function baselineMetrics(
  shots: AnalysisShot[],
  history: AnalysisShot[],
): BaselineMetrics {
  const routine = shots.filter((s) => eligible(s) && s.difficulty === "A");
  const groups = new Map<string, AnalysisShot[]>();
  history
    .filter((s) => eligible(s) && s.difficulty === "A")
    .forEach((s) => {
      const key = matchKey(s);
      if (key) groups.set(key, [...(groups.get(key) ?? []), s]);
    });
  const matched = routine.flatMap((shot) => {
    const previous = groups.get(matchKey(shot) ?? "") ?? [];
    return previous.length >= MIN_BASELINE_SHOTS
      ? [{ shot, expected: report(previous).percent! }]
      : [];
  });
  const actual = report(matched.map((s) => s.shot)).percent;
  const expected = matched.length
    ? matched.reduce((sum, s) => sum + s.expected, 0) / matched.length
    : null;
  const currentRated = rated(shots),
    pastRated = rated(history);
  const currentAverage = average(currentRated);
  const pastAverage =
    pastRated.length >= MIN_BASELINE_SHOTS ? average(pastRated) : null;
  return {
    routinePercent: report(routine).percent,
    routineShots: routine.length,
    matchedRoutineShots: matched.length,
    matchedRoutinePercent: actual,
    expectedRoutinePercent: expected,
    baselineGap:
      actual !== null && expected !== null ? actual - expected : null,
    routineMakeRate: routine.length
      ? (100 * routine.filter((s) => s.grade === 5).length) / routine.length
      : null,
    ratedShots: currentRated.length,
    gradedShots: report(shots).scored,
    averageDifficulty: currentAverage,
    baselineDifficulty: pastAverage,
    difficultyIndex:
      currentAverage !== null && pastAverage !== null
        ? (100 * currentAverage) / pastAverage
        : null,
    difficultShare: difficult(currentRated),
    baselineDifficultShare: pastAverage !== null ? difficult(pastRated) : null,
    baselineRatedShots: pastRated.length,
  };
}
function eventDate(event: CoachEvent) {
  const dates = event.games
    .map((g) => g.scheduledStart?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort();
  const value = event.startDate ?? dates[0];
  return value && Number.isFinite(Date.parse(value))
    ? value.slice(0, 10)
    : null;
}
/** Prior completed events only; same-day/overlapping events never leak into the baseline. */
export function eventPerformance(
  events: CoachEvent[],
  playerId?: string,
  currentEventId?: string,
): EventPerformance {
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  const ordered = unique
    .map((event) => ({ event, date: eventDate(event) }))
    .sort(
      (a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
        a.event.id.localeCompare(b.event.id),
    );
  return {
    currentEventId,
    points: ordered.map(({ event, date }) => {
      const previous = date
        ? ordered
            .filter(
              (past) =>
                past.date &&
                past.date < date &&
                past.event.organizationId === event.organizationId &&
                past.event.seasonId === event.seasonId &&
                past.event.games.length > 0 &&
                past.event.games.every(
                  (g) =>
                    g.status === "completed" &&
                    (g.scheduledStart?.slice(0, 10) ?? past.date!) < date,
                ),
            )
            .slice(-BASELINE_EVENTS)
        : [];
      const select = (e: CoachEvent) =>
        analysisEventShots(e).filter(
          (s) => !playerId || s.playerId === playerId,
        );
      const shots = select(event),
        history = previous.flatMap((past) => select(past.event));
      return {
        id: event.id,
        name: event.name,
        date,
        complete:
          event.games.length > 0 &&
          event.games.every((g) => g.status === "completed"),
        baselineEvents: previous.length,
        ...measure(shots),
        ...baselineMetrics(shots, history),
        byType: Object.fromEntries(
          shotTypes.map((type) => [
            type,
            measure(shots.filter((s) => s.type === type)),
          ]),
        ),
        bySubtype: Object.fromEntries(
          [
            ...new Set(
              shots.map((s) => s.shotSubtype).filter((s): s is string => !!s),
            ),
          ].map((subtype) => [
            subtype,
            measure(shots.filter((s) => s.shotSubtype === subtype)),
          ]),
        ),
        games: event.games.map((game) => ({
          id: game.id,
          name: game.label,
          ...baselineMetrics(select({ ...event, games: [game] }), history),
        })),
      };
    }),
  };
}
export function reportEventPerformance(event: CoachEvent, playerId?: string) {
  const date = eventDate(event);
  const history = (event.performanceHistory ?? []).filter((past) => {
    const pastDate = eventDate(past);
    return (
      past.organizationId === event.organizationId &&
      past.seasonId === event.seasonId &&
      date &&
      pastDate &&
      pastDate < date
    );
  });
  return eventPerformance([...history, event], playerId, event.id);
}
export function performanceEvidence(performance: EventPerformance): Evidence[] {
  const points = performance.points;
  const evidence: Evidence[] = [];
  const add = (id: string, label: string, value: string, sample: number) =>
    evidence.push({
      id: `event-trend-${id}`,
      label,
      value,
      sample,
      confidence: sample < 10 ? "small" : sample < 20 ? "tentative" : "event",
    });
  const pct = (n: number | null) =>
    n === null ? "not measured" : `${n.toFixed(1)}%`;
  const current =
    points.find((p) => p.id === performance.currentEventId) ?? points.at(-1);
  if (current) {
    add(
      "baseline",
      "Routine execution versus personal subtype baseline",
      `Routine shooting ${pct(current.routinePercent)} on ${current.routineShots} shots. Matched subset ${current.matchedRoutineShots}: actual ${pct(current.matchedRoutinePercent)}, expected ${pct(current.expectedRoutinePercent)}; gap ${current.baselineGap?.toFixed(1) ?? "unavailable"} percentage points. Full-make grade rate ${pct(current.routineMakeRate)}. Previous ${current.baselineEvents} completed events; unmatched shots excluded from gap.`,
      current.matchedRoutineShots,
    );
    add(
      "difficulty",
      "Shot-mix difficulty versus history",
      `Index ${current.difficultyIndex?.toFixed(0) ?? "unavailable"}; average ${current.averageDifficulty?.toFixed(2) ?? "unavailable"}, historical ${current.baselineDifficulty?.toFixed(2) ?? "unavailable"}. Rated ${current.ratedShots}/${current.gradedShots} graded shots; historical rated ${current.baselineRatedShots}. Difficult share ${pct(current.difficultShare)} versus historical ${pct(current.baselineDifficultShare)}. Ordinal weights A=1 B=2 C=3; 100 is baseline, not a percentage increase in difficulty or opponent strength.`,
      current.ratedShots,
    );
  }
  if (points.length > 1) {
    add(
      "overall",
      "Overall shooting across events in date order",
      points
        .map(
          (p, i) =>
            `Event ${i + 1} (${p.date ?? "date unavailable"}${p.complete ? "" : ", in progress"}): ${pct(p.percent)} on ${p.graded} graded shots`,
        )
        .join("; "),
      points.reduce((n, p) => n + p.graded, 0),
    );
    const changes = shotTypes
      .flatMap((type) => {
        const measured = points.filter((p) => p.byType[type].graded >= 5);
        if (measured.length < 2) return [];
        const first = measured[0],
          last = measured.at(-1)!;
        return [
          {
            type,
            measured,
            change: last.byType[type].percent! - first.byType[type].percent!,
          },
        ];
      })
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);
    for (const [i, change] of changes.entries())
      add(
        `type-${i}`,
        `${change.type}: event trend`,
        change.measured
          .map(
            (p) =>
              `${p.date ?? p.name}: ${pct(p.byType[change.type].percent)} (${p.byType[change.type].graded} graded)`,
          )
          .join("; ") +
          `; first-to-last change ${change.change.toFixed(1)} percentage points. Descriptive, not causal; shot mix may differ.`,
        Math.min(...change.measured.map((p) => p.byType[change.type].graded)),
      );
  }
  return evidence;
}
