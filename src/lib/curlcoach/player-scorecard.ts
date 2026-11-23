import {
  playerEventWindow,
  type EventPerformancePoint,
  type EventPerformance,
} from "./event-performance";
import type { ReportBlock } from "./report-content";
import type { SavedReport } from "./reports";
import { reportMatrix } from "./report-matrix";

type Point = EventPerformancePoint & {
  playerStats: NonNullable<EventPerformancePoint["playerStats"]>;
};
const pct = (n: number | null) => (n === null ? "—" : n.toFixed(1) + "%");
export function playerScorecard(report: SavedReport) {
  return report.playerId ? playerEventWindow(report.eventPerformance) : null;
}

function assignmentDifficulty(current: Point, prior: Point[]) {
  const average = (points: Point[]) => {
    let count = 0,
      total = 0;
    for (const { playerStats } of points)
      for (const b of playerStats.bands) {
        count += b.calls;
        total += b.calls * { A: 1, B: 2, C: 3 }[b.level];
      }
    return count ? total / count : null;
  };
  const now = average([current]),
    usual = average(prior);
  if (now === null) return "—";
  const value = now.toFixed(1) + "/3";
  if (usual === null) return value;
  const delta = Math.round(now * 10) - Math.round(usual * 10);
  return (
    value + " · " + (delta > 0 ? "Harder" : delta < 0 ? "Easier" : "Average")
  );
}

export function playerScorecardCards(p: Point, prior: Point[]) {
  const s = p.playerStats;
  return [
    { label: "Shooting", value: pct(p.percent) },
    { label: "Difficulty-adjusted shooting", value: pct(s.adjusted) },
    { label: "Event difficulty", value: assignmentDifficulty(p, prior) },
    {
      label: "Routine shooting",
      value: pct(s.bands.find((b) => b.level === "A")?.percent ?? null),
    },
  ];
}

export function playerMatrices(
  data: EventPerformance,
  { current, points }: NonNullable<ReturnType<typeof playerScorecard>>,
) {
  const games = current.games.flatMap((game, index) => {
    if (!game.playerStats) return [];
    const name =
      game.opponent && /^game \d+$/i.test(game.name)
        ? game.opponent
        : [game.name, game.opponent].filter(Boolean).join(" · ");
    return [{ key: "G" + (index + 1), name, stats: game.playerStats }];
  });
  return [
    reportMatrix("Event Stats", games, current.playerStats),
    reportMatrix(
      "Trends over time (by event)",
      points.map((p, index) => ({
        key: "E" + (index + 1),
        name: p.name,
        stats: p.playerStats,
      })),
      data.playerTrendTotal,
    ),
  ] as const;
}
export function playerScorecardBlocks(
  report: SavedReport,
  window: NonNullable<ReturnType<typeof playerScorecard>>,
  missBlocks: ReportBlock[] = [],
) {
  const [event, trends] = playerMatrices(report.eventPerformance!, window);
  const narrative = report.narrative;
  if ("eventStats" in narrative) {
    event.narrative = narrative.eventStats.map((f) => f.text).join(" ");
    trends.narrative = narrative.eventTrends.map((f) => f.text).join(" ");
  }
  const blocks: ReportBlock[] = [event, ...missBlocks, trends];
  const heading = (title: string) =>
    blocks.push({ kind: "heading", title, startPage: false });
  const practice =
    "practice" in narrative ? narrative.practice[0]?.text : undefined;
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
