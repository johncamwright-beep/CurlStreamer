import { currentShots, report, shotTypes, type Shot } from "./model";
import { advancedReport } from "./advanced-report";
import type { CoachEvent } from "./event";
import type { Evidence } from "./reports";

export type TrendHighlights = {
  strengths: Evidence[];
  priorities: Evidence[];
  withinGames: Evidence[];
  acrossGames: Evidence[];
};

/** Descriptive comparisons only: missing observations never become clean attempts. */
export function reportTrends(
  event: CoachEvent,
  playerId?: string,
): TrendHighlights {
  const games = event.games.map((game, i) => ({
    game,
    index: i + 1,
    shots: currentShots(game.state.events).filter(
      (s) => !s.excluded && (!playerId || s.playerId === playerId),
    ),
  }));
  const shots = games.flatMap((g) => g.shots);
  const result: TrendHighlights = {
    strengths: [],
    priorities: [],
    withinGames: [],
    acrossGames: [],
  };
  const evidence = (
    id: string,
    label: string,
    value: string,
    sample: number,
  ): Evidence => ({
    id,
    label,
    value,
    sample,
    confidence: sample < 10 ? "small" : sample < 20 ? "tentative" : "event",
  });
  const shooting = (pool: Shot[]) => {
    const r = report(pool);
    return r.scored
      ? `${r.percent!.toFixed(1)}% (${r.scored} graded shots)`
      : "not assessed";
  };
  const advanced = advancedReport(event, playerId).groups.flatMap(
    (g) => g.metrics,
  );
  const advancedGames = games.map((g) => ({
    index: g.index,
    metrics: advancedReport(
      { ...event, games: [g.game] },
      playerId,
      "advanced",
      true,
    ).groups.flatMap((group) => group.metrics),
  }));
  const types = shotTypes.flatMap((type, i) => {
    const pool = shots.filter((s) => s.type === type);
    const r = report(pool);
    return r.scored >= 5
      ? [evidence(`highlight-type-${i}`, type, shooting(pool), r.scored)]
      : [];
  });
  const subtypes = advanced.filter(
    (e) => e.id.startsWith("advanced-subtype-") && e.sample >= 5,
  );
  result.strengths = [...types, ...subtypes]
    .sort(
      (a, b) =>
        parseFloat(b.value) - parseFloat(a.value) || b.sample - a.sample,
    )
    .slice(0, 5);
  result.priorities = advanced
    .filter(
      (e) =>
        /advanced-(resultObservations|results-|paired-|misses|execution-)/.test(
          e.id,
        ) &&
        e.sample >= 5 &&
        (e.basis?.numerator ?? 0) >= 2 &&
        !e.id.endsWith("-none"),
    )
    .sort((a, b) => (b.basis?.numerator ?? 0) - (a.basis?.numerator ?? 0))
    .slice(0, 5);
  const deficiencies = shots.filter((s) => s.deficiency !== null);
  for (const tag of [
    "Light",
    "Heavy",
    "Undercurl",
    "Overcurl",
    "Management",
  ] as const) {
    const count = deficiencies.filter((s) => s.deficiency === tag).length;
    if (count >= 2 && deficiencies.length >= 5)
      result.priorities.push({
        ...evidence(
          `highlight-miss-${tag}`,
          `${tag}: observed deficiency`,
          `${((100 * count) / deficiencies.length).toFixed(1)}% (${count} of ${deficiencies.length} assessed deficiencies)`,
          deficiencies.length,
        ),
        basis: {
          numerator: count,
          denominator: deficiencies.length,
          unit: "shots",
        },
      });
  }
  result.priorities.sort(
    (a, b) => (b.basis?.numerator ?? 0) - (a.basis?.numerator ?? 0),
  );
  result.priorities = result.priorities.slice(0, 5);

  for (const { game, index, shots: pool } of games) {
    // Use actual played ends when known. Do not invent late ends after a concession.
    const last = Math.max(
      0,
      ...game.ends.map((e) => e.end),
      ...pool.map((s) => s.end),
    );
    if (last < 4) continue;
    const split = Math.floor(last / 2);
    const early = pool.filter((s) => s.end <= split);
    const late = pool.filter((s) => s.end > split);
    const a = report(early),
      b = report(late);
    if (a.scored >= 4 && b.scored >= 4)
      result.withinGames.push(
        evidence(
          `trend-game-${index}`,
          `Game ${index}: opening to closing ends`,
          `Ends 1–${split}: ${shooting(early)}; ends ${split + 1}–${last}: ${shooting(late)}; change ${(b.percent! - a.percent!).toFixed(1)} percentage points. Shot mix may differ; descriptive comparison.`,
          Math.min(a.scored, b.scored),
        ),
      );
  }
  result.withinGames.sort((a, b) => {
    const delta = (e: Evidence) =>
      Math.abs(Number(e.value.match(/change (-?[\d.]+)/)?.[1] ?? 0));
    return delta(b) - delta(a);
  });
  result.withinGames = result.withinGames.slice(0, 5);

  // Follow the SAME category across all games, including assessed zeroes and gaps.
  // At least two observations of a miss overall and two adequately charted games.
  for (const type of [null, ...shotTypes]) {
    const series = games.map((g) => ({
      ...g,
      pool: g.shots.filter((s) => type === null || s.type === type),
    }));
    const assessed = series.filter((g) => report(g.pool).scored >= 4);
    if (assessed.length < 2) continue;
    const values = assessed.map((g) => report(g.pool).percent!);
    if (Math.max(...values) - Math.min(...values) < 10) continue;
    result.acrossGames.push(
      evidence(
        `trend-shooting-${type === null ? "overall" : shotTypes.indexOf(type)}`,
        `${type ?? "Overall"}: shooting through the event`,
        series.map((g) => `Game ${g.index}: ${shooting(g.pool)}`).join("; ") +
          ". Compare the full sequence; sparse games and different difficulty mix limit conclusions.",
        Math.min(...assessed.map((g) => report(g.pool).scored)),
      ),
    );
  }
  for (const tag of [
    "Light",
    "Heavy",
    "Undercurl",
    "Overcurl",
    "Management",
  ] as const) {
    const series = games.map((g) => {
      const pool = g.shots.filter((s) => s.deficiency !== null);
      const count = pool.filter((s) => s.deficiency === tag).length;
      return { index: g.index, count, total: pool.length };
    });
    if (
      series.reduce((n, g) => n + g.count, 0) < 2 ||
      series.filter((g) => g.total >= 4).length < 2
    )
      continue;
    result.acrossGames.push(
      evidence(
        `trend-miss-${tag}`,
        `${tag}: observed recurrence across games`,
        series
          .map(
            (g) =>
              `Game ${g.index}: ${g.total ? `${((100 * g.count) / g.total).toFixed(1)}% (${g.count} of ${g.total} assessed deficiencies)` : "not assessed"}`,
          )
          .join("; ") +
          ". A lower recorded share does not establish that an adjustment fixed the miss.",
        Math.min(...series.filter((g) => g.total >= 4).map((g) => g.total)),
      ),
    );
  }
  // Track the same explicitly assessed Enhanced result through every game.
  for (const metric of advanced.filter(
    (e) =>
      /advanced-results-/.test(e.id) &&
      !e.id.endsWith("-none") &&
      (e.basis?.numerator ?? 0) >= 2,
  )) {
    const series = advancedGames.map((g) => ({
      index: g.index,
      metric: g.metrics.find((e) => e.id === metric.id),
    }));
    const measured = series.filter((g) => (g.metric?.sample ?? 0) >= 4);
    if (measured.length < 2) continue;
    result.acrossGames.unshift(
      evidence(
        `trend-${metric.id}`,
        `${metric.label}: across games`,
        series
          .map((g) => `Game ${g.index}: ${g.metric?.value ?? "not assessed"}`)
          .join("; "),
        Math.min(...measured.map((g) => g.metric!.sample)),
      ),
    );
  }
  // Reserve slots for both Standard and Enhanced observations as well as shooting changes.
  const queues = [
    result.acrossGames.filter((e) => e.id.startsWith("trend-miss-")),
    result.acrossGames.filter((e) => e.id.startsWith("trend-advanced-")),
    result.acrossGames.filter((e) => e.id.startsWith("trend-shooting-")),
  ];
  const salience = (e: Evidence) => {
    const rates = [...e.value.matchAll(/(\d+(?:\.\d+)?)%/g)].map((m) =>
      Number(m[1]),
    );
    return rates.length
      ? (Math.max(...rates) - Math.min(...rates) + Math.max(...rates) / 4) *
          Math.sqrt(e.sample)
      : 0;
  };
  queues.forEach((q) => q.sort((a, b) => salience(b) - salience(a)));
  result.acrossGames = [];
  while (result.acrossGames.length < 5 && queues.some((q) => q.length)) {
    for (const q of queues) {
      const next = q.shift();
      if (next && result.acrossGames.length < 5) result.acrossGames.push(next);
    }
  }
  return result;
}
