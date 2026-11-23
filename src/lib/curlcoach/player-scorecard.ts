import type { EventPerformancePoint } from "./event-performance";
import type { ReportBlock } from "./report-content";
import type { SavedReport } from "./reports";
import { difficultyBenchmarks } from "./difficulty";
import { reportMatrix } from "./report-matrix";

type Point = EventPerformancePoint & {
  playerStats: NonNullable<EventPerformancePoint["playerStats"]>;
};
const pct = (n: number | null) => (n === null ? "—" : n.toFixed(1) + "%");
const hasStats = (p: EventPerformancePoint): p is Point =>
  !!p.playerStats?.shooting;

export function playerScorecard(report: SavedReport) {
  const data = report.eventPerformance;
  const current = data?.points.find((p) => p.id === data.currentEventId);
  if (!report.playerId || !current || !hasStats(current)) return null;
  const prior = data!.points
    .filter(hasStats)
    .filter(
      (p) =>
        p.complete &&
        p.date &&
        current.date &&
        p.date < current.date &&
        p.playerStats.attempts > 0,
    );
  return { current, prior };
}

export function playerScorecardCards(p: Point) {
  const s = p.playerStats;
  return [
    {
      label: "Shooting",
      value: pct(p.percent),
      basis: `${p.graded} graded · ${s.attempts} charted`,
    },
    {
      label: "Difficulty-adjusted shooting",
      value: s.adjusted === null ? "—" : `${s.adjusted.toFixed(1)} pts`,
      basis: `Easy-shot scale · ${s.ratedGraded} of ${p.graded} graded shots rated`,
    },
  ];
}

export function playerScorecardBlocks(
  report: SavedReport,
  { current, prior }: NonNullable<ReturnType<typeof playerScorecard>>,
) {
  const points = [...prior.slice(-4), current];
  const games = current.games.flatMap((game, index) => {
    if (!game.playerStats) return [];
    const name =
      game.opponent && /^game \d+$/i.test(game.name)
        ? game.opponent
        : [game.name, game.opponent].filter(Boolean).join(" · ");
    return [{ key: "G" + (index + 1), name, stats: game.playerStats }];
  });
  const bench = difficultyBenchmarks.expected;
  const blocks: ReportBlock[] = [
    {
      kind: "text",
      value: `Easy-shot allowance · Easy +0 · Moderate +${bench.A - bench.B} · Difficult +${bench.A - bench.C} pts`,
      size: 8,
      muted: true,
    },
    reportMatrix("Event Stats", games),
    reportMatrix(
      "Trends",
      points.map((p, index) => ({
        key: "E" + (index + 1),
        name: p.name,
        stats: p.playerStats,
      })),
    ),
  ];
  const heading = (title: string) =>
    blocks.push({ kind: "heading", title, startPage: false });
  const practice = report.narrative.practice[0]?.text;
  if (practice) {
    heading("Next practice");
    blocks.push({ kind: "text", value: practice, size: 9, muted: false });
  }
  if (report.flags?.length) {
    heading("Flagged shots");
    for (const flag of report.flags) blocks.push({ kind: "flag", flag });
  }
  return blocks;
}
