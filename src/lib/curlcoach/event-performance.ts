import { analysisEventShots, type AnalysisShot } from "./advanced-analysis";
import { report, shotTypes, turns } from "./model";
import { difficultyWeight, difficultProbability } from "./difficulty";
import type { CoachEvent, Workspace } from "./event";
import type { Evidence } from "./reports";
import { playerEventStats } from "./player-event-stats";
import { technicalSummary } from "./technical";

export const MIN_BASELINE_SHOTS = 1;
/** Same shot-weighted season reference for every event/game in the comparison. */
export function relativeDifficulty(
  metrics: Pick<BaselineMetrics, "averageDifficulty" | "seasonDifficulty">,
): number | null {
  const current = metrics.averageDifficulty,
    baseline = metrics.seasonDifficulty;
  if (
    current == null ||
    baseline == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(baseline) ||
    baseline <= 0
  )
    return null;
  return (100 * current) / baseline;
}
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
  estimatedShots?: number;
  gradedShots: number;
  averageDifficulty: number | null;
  baselineDifficulty: number | null;
  seasonDifficulty?: number | null;
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
    playerStats?: PlayerPeriodStats;
    games: (BaselineMetrics & {
      id: string;
      name: string;
      opponent?: string;
      playerStats?: PlayerPeriodStats;
    })[];
  };
export type EventPerformance = {
  points: EventPerformancePoint[];
  currentEventId?: string;
  playerTrendTotal?: PlayerPeriodStats;
};
type PlayerPoint = EventPerformancePoint & { playerStats: PlayerPeriodStats };
export function playerEventWindow(data?: EventPerformance) {
  const hasStats = (p: EventPerformancePoint): p is PlayerPoint =>
    !!p.playerStats?.shooting;
  const current = data?.points.find((p) => p.id === data.currentEventId);
  if (!data || !current || !hasStats(current)) return null;
  const prior = data.points
    .filter(hasStats)
    .filter(
      (p) =>
        p.complete &&
        p.date &&
        current.date &&
        p.date < current.date &&
        p.playerStats.attempts > 0,
    );
  return { current, prior, points: [...prior.slice(-4), current] };
}

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
function shootingByType(shots: AnalysisShot[]) {
  return Object.fromEntries(
    shotTypes.map((type) => [
      type,
      measure(shots.filter((s) => s.type === type)),
    ]),
  );
}

function playerPeriodStats(
  shots: AnalysisShot[],
  byType = shootingByType(shots),
) {
  return {
    ...playerEventStats(shots),
    shooting: measure(shots),
    byType,
    byTurn: Object.fromEntries(
      turns.map((turn) => [
        turn,
        measure(shots.filter((s) => s.turn === turn)),
      ]),
    ),
    technical: technicalSummary(shots)
      .filter((group) => group.recorded)
      .map((group) => ({
        title: group.title,
        recorded: group.recorded,
        rows: group.rows
          .filter((row) => row.count)
          .map(({ label, count, shooting, graded }) => ({
            label,
            count,
            percent: shooting,
            graded,
          })),
      })),
  };
}
export type PlayerPeriodStats = ReturnType<typeof playerPeriodStats>;
const rated = (shots: AnalysisShot[]) =>
  shots.filter((s) => eligible(s) && difficultyWeight(s) !== undefined);
const average = (shots: AnalysisShot[]) =>
  shots.length
    ? shots.reduce((sum, s) => sum + difficultyWeight(s)!, 0) / shots.length
    : null;
const difficult = (shots: AnalysisShot[]) =>
  shots.length
    ? (100 * shots.reduce((sum, s) => sum + difficultProbability(s), 0)) /
      shots.length
    : null;
export function baselineMetrics(
  shots: AnalysisShot[],
  history: AnalysisShot[],
): BaselineMetrics {
  const routine = shots.filter((s) => eligible(s) && s.difficulty === "A");
  const historicalRoutine = history.filter(
    (s) => eligible(s) && s.difficulty === "A",
  );
  const actual = report(routine).percent;
  const expected = report(historicalRoutine).percent;
  const currentRated = rated(shots),
    pastRated = rated(history);
  const currentAverage = average(currentRated);
  const pastAverage =
    pastRated.length >= MIN_BASELINE_SHOTS ? average(pastRated) : null;
  return {
    routinePercent: report(routine).percent,
    routineShots: routine.length,
    matchedRoutineShots: expected === null ? 0 : routine.length,
    matchedRoutinePercent: actual,
    expectedRoutinePercent: expected,
    baselineGap:
      actual !== null && expected !== null ? actual - expected : null,
    routineMakeRate: routine.length
      ? (100 * routine.filter((s) => s.grade === 5).length) / routine.length
      : null,
    ratedShots: currentRated.length,
    estimatedShots: 0,
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
  includePlayerStats = false,
): EventPerformance {
  const unique = [...new Map(events.map((e) => [e.id, e])).values()];
  const ordered = unique
    .map((event) => ({
      event,
      date: eventDate(event),
      shots: analysisEventShots(event).filter(
        (s) => !playerId || s.playerId === playerId,
      ),
    }))
    .sort(
      (a, b) =>
        (a.date ?? "9999").localeCompare(b.date ?? "9999") ||
        a.event.id.localeCompare(b.event.id),
    );
  const data: EventPerformance = {
    currentEventId,
    points: ordered.map(({ event, date, shots }) => {
      const previous = date
        ? ordered.filter(
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
        : [];
      const history = previous.flatMap((past) => past.shots);
      const byType = shootingByType(shots);
      const seasonDifficulty = average(
        rated(
          ordered
            .filter(
              ({ event: other }) =>
                other.organizationId === event.organizationId &&
                other.seasonId === event.seasonId,
            )
            .flatMap((other) => other.shots),
        ),
      );
      return {
        id: event.id,
        name: event.name,
        date,
        complete:
          event.games.length > 0 &&
          event.games.every((g) => g.status === "completed"),
        baselineEvents: previous.length,
        ...measure(shots),
        ...(includePlayerStats && playerId
          ? { playerStats: playerPeriodStats(shots, byType) }
          : {}),
        ...baselineMetrics(shots, history),
        seasonDifficulty,
        byType,
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
        games: event.games.map((game) => {
          const gameShots = shots.filter((s) => s.gameId === game.id);
          return {
            id: game.id,
            name: game.label,
            opponent: game.opponent,
            ...baselineMetrics(gameShots, history),
            ...(includePlayerStats && playerId && event.id === currentEventId
              ? { playerStats: playerPeriodStats(gameShots) }
              : {}),
            seasonDifficulty,
          };
        }),
      };
    }),
  };
  if (includePlayerStats && playerId) {
    const window = playerEventWindow(data);
    if (window) {
      const ids = new Set(window.points.map((p) => p.id));
      data.playerTrendTotal = playerPeriodStats(
        ordered.filter((p) => ids.has(p.event.id)).flatMap((p) => p.shots),
      );
    }
  }
  return data;
}
export function reportEventPerformance(
  event: CoachEvent,
  playerId?: string,
  includePlayerStats = false,
) {
  const date = eventDate(event);
  const history = (event.performanceHistory ?? []).filter((past) => {
    const pastDate = eventDate(past);
    return (
      past.organizationId === event.organizationId &&
      past.seasonId === event.seasonId &&
      date &&
      pastDate &&
      pastDate < date &&
      past.games.every(
        (game) => (game.scheduledStart?.slice(0, 10) ?? pastDate) < date,
      )
    );
  });
  return eventPerformance(
    [...history, event],
    playerId,
    event.id,
    includePlayerStats,
  );
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
      "Routine execution versus historical routine baseline",
      `Routine shooting ${pct(current.routinePercent)} on ${current.routineShots} shots. Routine comparison uses ${current.matchedRoutineShots} current shots: actual ${pct(current.matchedRoutinePercent)}, expected ${pct(current.expectedRoutinePercent)}; gap ${current.baselineGap?.toFixed(1) ?? "unavailable"} percentage points. Full-make grade rate ${pct(current.routineMakeRate)}. Previous ${current.baselineEvents} completed events. All eligible historical routine shots are pooled; no subtype match is required.`,
      current.matchedRoutineShots,
    );
    add(
      "difficulty",
      "Shot-mix difficulty versus history",
      `Relative difficulty ${relativeDifficulty(current)?.toFixed(1) ?? "unavailable"} (100 = shot-weighted season average rating; same reference for every plotted event, no clipping). Historical ratio index ${current.difficultyIndex?.toFixed(0) ?? "unavailable"}; average ${current.averageDifficulty?.toFixed(2) ?? "unavailable"}, historical ${current.baselineDifficulty?.toFixed(2) ?? "unavailable"}. Rated ${current.ratedShots}/${current.gradedShots} graded shots; historical rated ${current.baselineRatedShots}. Difficult share ${pct(current.difficultShare)} versus historical ${pct(current.baselineDifficultShare)}. Ordinal weights A=1 B=2 C=3; 100 is baseline, not a percentage increase in difficulty or opponent strength.`,
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
