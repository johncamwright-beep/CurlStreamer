import type {
  EventPerformancePoint,
  PerformanceMeasure,
} from "./event-performance";
import type { ReportBlock } from "./report-content";
import type { SavedReport } from "./reports";
import { difficultyBenchmarks, difficultyLabels } from "./difficulty";
import { comparableRatings } from "./player-event-stats";
import { missTags } from "./report-misses";
import { shotTypes } from "./model";

type Point = EventPerformancePoint & {
  playerStats: NonNullable<EventPerformancePoint["playerStats"]>;
};
const pct = (n: number | null) => (n === null ? "—" : n.toFixed(1) + "%");
const rate = (count: number, total: number) =>
  total ? (100 * count) / total : null;
const hasStats = (p: EventPerformancePoint): p is Point => !!p.playerStats;
const counts = (p: PerformanceMeasure | undefined) =>
  p?.percent != null ? `${pct(p.percent)} (${p.graded})` : "—";

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
  const blocks: ReportBlock[] = [];
  const heading = (title: string, startPage = false) =>
    blocks.push({ kind: "heading", title, startPage });
  const text = (value: string) =>
    blocks.push({ kind: "text", value, size: 9, muted: false });
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    layout?: "rates" | "paired",
  ) => blocks.push({ kind: "table", headers, rows, widths, layout });
  const points = [...prior.slice(-5), current];
  const recent = points.slice(-3);
  const bench = difficultyBenchmarks.expected;
  text(
    `Model allowance per rated shot · Easy +0 · Moderate +${bench.A - bench.B} · Difficult +${bench.A - bench.C} points`,
  );

  heading("Shooting and shot difficulty by event");
  const comparable = prior.filter((p) =>
    comparableRatings(p.playerStats.observed, p.playerStats.attempts),
  );
  if (
    comparableRatings(
      current.playerStats.observed,
      current.playerStats.attempts,
    )
  ) {
    const demanding = (p: Point) =>
      p.playerStats.observed - p.playerStats.bands[0].calls;
    const share = rate(demanding(current), current.playerStats.observed)!;
    const before = rate(
      comparable.reduce((n, p) => n + demanding(p), 0),
      comparable.reduce((n, p) => n + p.playerStats.observed, 0),
    );
    text(
      `Moderate or difficult calls · ${pct(share)} this event${before === null ? "" : ` · ${pct(before)} ${comparable.length === 1 ? "at " + comparable[0].name : "across " + comparable.length + " prior rated events"}`}`,
    );
  }
  table(
    ["Event", "Shooting", "Easy", "Moderate", "Difficult", "Rated / calls"],
    points.map((p) => {
      const s = p.playerStats;
      return [
        p.name,
        counts(p),
        ...s.bands.map((b) =>
          comparableRatings(s.observed, s.attempts)
            ? pct(rate(b.calls, s.observed))
            : "—",
        ),
        `${s.observed}/${s.attempts}`,
      ];
    }),
    [50, 30, 21, 26, 23, 28],
    "rates",
  );
  text("Difficulty comparisons require 10 coach-rated shots and 70% coverage.");
  const byBand = current.playerStats.bands
    .filter((b) => b.graded)
    .map((b) => `${difficultyLabels[b.level]} ${pct(b.percent)} (${b.graded})`);
  if (byBand.length) text("Shooting by difficulty · " + byBand.join(" · "));
  const analysis = report.analysis;
  if (analysis?.games.some((g) => g.shots)) {
    heading("Shooting by game");
    const games = analysis.games.flatMap((g, i) =>
      g.shots ? [{ ...g, opponent: current.games[i]?.opponent }] : [],
    );
    for (let offset = 0; offset < games.length; offset += 6) {
      const group = games.slice(offset, offset + 6);
      blocks.push({
        kind: "trend",
        firstGame: offset + 1,
        eventLabels: group.map(
          (g) => g.label.match(/^Game (\d+)$/)?.[1] ?? g.label,
        ),
        firstColumnLabel: "Game",
        valueLabel: "Shooting",
        games: group,
        rows: group.map((g) => [
          `${g.label} · ${g.opponent ?? ""}`,
          pct(g.percent),
          String(g.graded),
        ]),
      });
    }
  }

  const practice = report.narrative.practice[0]?.text;
  if (practice) {
    heading("Next practice");
    text(practice);
  }
  heading("Shot performance", true);
  const headers = ["Shot", ...recent.map((p) => p.name), "Change"];
  const dataWidth = 102 / recent.length;
  const widths = [48, ...recent.map(() => dataWidth), 28];
  const previous = prior.at(-1);
  const change = (
    now: PerformanceMeasure | undefined,
    past: PerformanceMeasure | undefined,
  ) => {
    if (
      !now ||
      !past ||
      now.graded < 5 ||
      past.graded < 5 ||
      now.percent === null ||
      past.percent === null
    )
      return "—";
    const delta = now.percent - past.percent;
    return `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp`;
  };
  table(
    headers,
    shotTypes
      .filter((type) => recent.some((p) => p.byType[type]?.graded))
      .map((type) => [
        type,
        ...recent.map((p) => counts(p.byType[type])),
        change(current.byType[type], previous?.byType[type]),
      ]),
    widths,
    "rates",
  );
  text(
    "Shooting % (graded shots). Change since the previous event requires five grades in each.",
  );
  heading("Miss patterns");
  const outcome = (n: number, total: number) =>
    total ? `${pct(rate(n, total))} (${n}/${total})` : "—";
  const categories = [...missTags, "Untagged"] as const;
  const frequency = (p: Point, tag: (typeof categories)[number]) =>
    tag === "Untagged"
      ? p.playerStats.misses - p.playerStats.tagged
      : (p.playerStats.categories.find((c) => c.tag === tag)?.count ?? 0);
  table(
    ["Per recorded outcome", ...recent.map((p) => p.name)],
    [
      [
        "Partial / limited / miss",
        ...recent.map((p) =>
          outcome(p.playerStats.misses, p.playerStats.classified),
        ),
      ],
      [
        "Complete miss",
        ...recent.map((p) =>
          outcome(p.playerStats.fullMisses, p.playerStats.classified),
        ),
      ],
      ...categories
        .filter((tag) => recent.some((p) => frequency(p, tag) > 0))
        .map((tag) => [
          tag,
          ...recent.map((p) =>
            tag !== "Untagged" && p.playerStats.misses && !p.playerStats.tagged
              ? "—"
              : outcome(frequency(p, tag), p.playerStats.classified),
          ),
        ]),
    ],
    [48, ...recent.map(() => 130 / recent.length)],
    "rates",
  );

  if (analysis?.turns.length) {
    heading("Performance by turn");
    table(
      ["Turn / target", "Shooting (shots)"],
      analysis.turns.map((r) => [r.label, counts(r)]),
      [40, 49],
      "paired",
    );
  }
  const observations =
    analysis?.technical.flatMap((g) =>
      g.rows
        .filter((r) => r.count)
        .map((r) => [
          `${g.title} · ${r.label}`,
          `${r.count}/${g.recorded}`,
          pct(r.shooting),
        ]),
    ) ?? [];
  if (observations.length) {
    if (observations.length === 1) {
      const [label, sample, shooting] = observations[0];
      text(`${label} · ${sample} observations · ${shooting} shooting`);
    } else {
      heading("Technical observations");
      table(
        ["Observation", "Times recorded", "Shooting"],
        observations,
        [84, 49, 45],
      );
    }
  }
  if (report.flags?.length) {
    heading("Flagged shots");
    for (const flag of report.flags) blocks.push({ kind: "flag", flag });
  }
  return blocks;
}
