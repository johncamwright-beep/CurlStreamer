import { relativeDifficulty } from "./event-performance";
import {
  difficultyCaveat,
  difficultyDescription,
  difficultyPercent,
  type DifficultySummary,
} from "./difficulty";
import type { SavedReport } from "./reports";
import type { ReportMatrix } from "./report-matrix";
import type { ReportFlag } from "./flagged-shots";
import {
  reportDifficultyEvidenceText,
  reportPercentages,
  reportSections,
} from "./report-presentation";
import { reportLegend } from "./report-legend";
import { basisText, countPercent, evidenceBasis } from "./report-counts";
import type { ShootingRow } from "./report-analysis";
import {
  playerScorecard,
  playerScorecardBlocks,
  playerScorecardCards,
} from "./player-scorecard";

export type ReportBlock =
  | ReportMatrix
  | {
      kind: "heading";
      title: string;
      startPage: boolean;
      keepWithChart?: boolean;
    }
  | { kind: "text"; value: string; size: number; muted: boolean }
  | {
      kind: "table";
      headers: string[];
      rows: string[][];
      widths: number[];
      layout?: "paired" | "shooting" | "rates";
    }
  | {
      kind: "trend";
      games: ShootingRow[];
      rows?: string[][];
      secondary?: (number | null)[];
      valueLabel?: string;
      firstColumnLabel?: string;
      reference?: number;
      firstGame: number;
      eventLabels?: string[];
      minimum?: number;
      maximum?: number;
      unit?: string;
    }
  | { kind: "practice"; number: number; text: string }
  | { kind: "flag"; flag: ReportFlag };

const percentage = (value: number | null) =>
  value === null ? "Not measured" : `${value.toFixed(1)}%`;

export function reportTrendPoints(games: ShootingRow[]) {
  return games.map((game, index) => ({
    x: games.length === 1 ? 0.5 : index / (games.length - 1),
    value: game.percent,
  }));
}

export function reportSummaryCards(
  report: SavedReport,
): {
  label: string;
  value: string;
  basis?: string;
  direction?: number;
  difficulty?: number;
}[] {
  const scorecard = playerScorecard(report);
  if (scorecard)
    return playerScorecardCards(scorecard.current, scorecard.prior);
  const stats = reportPercentages(report);
  const current = report.eventPerformance?.points.find(
    (p) => p.id === report.eventPerformance?.currentEventId,
  );
  return [
    ...stats
      .filter((m) => m.id === "overall" || m.id === "adjusted")
      .map((m) => ({ label: m.label, value: m.value, basis: m.basis })),
    ...(current
      ? [
          {
            label: "Routine shot percentage",
            value: percentage(current.routinePercent),
            basis: `${current.routineShots} routine graded shots`,
          },
          {
            label: "Routine baseline gap",
            value:
              current.baselineGap === null
                ? "Not measured"
                : `${current.baselineGap >= 0 ? "+" : ""}${current.baselineGap.toFixed(1)} pp`,
            basis: `${current.routineShots} routine shots`,
          },
          {
            label: "Season difficulty index",
            value:
              relativeDifficulty(current) === null
                ? "Not measured"
                : relativeDifficulty(current)!.toFixed(1),
            basis: current.estimatedShots
              ? `${current.ratedShots} shots · ${current.estimatedShots} estimated`
              : current.ratedShots + " rated shots · 100 = season average",
          },
          {
            label: "Difficulty versus history",
            value:
              current.difficultyIndex === null
                ? "Not measured"
                : (current.difficultyIndex >= 100 ? "+" : "") +
                  (current.difficultyIndex - 100).toFixed(1) +
                  "%",
            basis: current.baselineRatedShots + " historical rated shots",
            direction:
              current.difficultyIndex === null
                ? 0
                : Math.sign(current.difficultyIndex - 100),
          },
        ]
      : []),
    ...(report.misses
      ? [
          {
            label: "Partial / limited / miss",
            value: percentage(report.misses.rate),
            basis: `${report.misses.misses} of ${report.misses.classified} shots`,
          },
        ]
      : []),
  ];
}

export function reportContent(report: SavedReport) {
  const scorecard = playerScorecard(report);
  if (scorecard) return playerScorecardBlocks(report, scorecard);
  const blocks: ReportBlock[] = [];
  const stats = reportPercentages(report);
  const heading = (title: string, startPage = false, keepWithChart = false) => {
    blocks.push({ kind: "heading", title, startPage, keepWithChart });
  };
  const text = (value: string, size = 10, muted = false) => {
    if (!muted) blocks.push({ kind: "text", value, size, muted });
  };
  const table = (
    headers: string[],
    rows: string[][],
    widths: number[],
    layout?: "paired" | "shooting",
  ) => {
    blocks.push({ kind: "table", headers, rows, widths, layout });
  };
  const sections = reportSections(report);
  if (report.playerComparison?.length) {
    heading("Player comparison");
    table(
      ["Player", "Shooting", "Adjusted shooting", "Rated / graded"],
      report.playerComparison.map((p) => [
        p.name,
        percentage(p.shooting),
        percentage(p.adjusted),
        `${p.rated}/${p.graded}`,
      ]),
      [63, 37, 39, 39],
    );
  }
  const difficultyBlock = (d: DifficultySummary) => {
    heading("Difficulty context - secondary metric");
    text(difficultyDescription(d));
    text(
      `Classified subset actual ${difficultyPercent(d.actual)}; expected ${difficultyPercent(d.expected)}. Easy benchmark ${difficultyPercent(d.benchmarks.expected.A)}.`,
    );
    table(
      ["Difficulty", "Shots / mix", "Actual", "Expected"],
      d.mix.map((r) => [
        r.level,
        `${r.count} / ${difficultyPercent(r.share)}`,
        difficultyPercent(r.actual),
        difficultyPercent(r.expected),
      ]),
      [35, 63, 40, 40],
    );
    text(difficultyCaveat);
  };
  if (!report.highlights && report.difficulty)
    difficultyBlock(report.difficulty);
  heading("Overall assessment");
  text(sections[0].findings[0].text);
  function findings() {
    for (const section of sections
      .slice(1)
      .filter((section) => section.title !== "Next practice")) {
      heading(section.title);
      section.findings.forEach((finding, index) => {
        if (section.title === "Next practice")
          blocks.push({
            kind: "practice",
            number: index + 1,
            text: finding.text,
          });
        else text(finding.text);
        if (finding.statistics.length)
          text(
            finding.statistics
              .map((stat) => `${stat.label}: ${stat.value}`)
              .join(" | "),
            8,
            true,
          );
      });
    }
  }
  const progression = report.eventPerformance;
  if (progression?.points.length) {
    heading("This event versus prior events");
    const points = progression.points;
    const current =
      points.find((p) => p.id === progression.currentEventId) ?? points.at(-1)!;
    const prior = points.filter(
      (p) =>
        p.id !== current.id &&
        p.complete &&
        p.date &&
        current.date &&
        p.date < current.date &&
        p.percent !== null,
    );
    const total = prior.reduce((n, p) => n + p.graded, 0);
    const historical = total
      ? prior.reduce((n, p) => n + p.percent! * p.graded, 0) / total
      : null;
    const gap =
      current.percent !== null && historical !== null
        ? current.percent - historical
        : null;
    const difficultyChange =
      current.difficultyIndex === null ? null : current.difficultyIndex - 100;
    const narrative = [
      current.percent === null
        ? "No graded shots are available for this event."
        : gap === null
          ? "Shooting was " +
            percentage(current.percent) +
            ". This event establishes a starting point for future comparisons."
          : "Shooting was " +
            percentage(current.percent) +
            ", " +
            Math.abs(gap).toFixed(1) +
            " percentage points " +
            (gap >= 0 ? "above" : "below") +
            " the prior-event average of " +
            percentage(historical) +
            ".",
    ];
    if (difficultyChange !== null)
      narrative.push(
        "The recorded shot mix was " +
          Math.abs(difficultyChange).toFixed(1) +
          "% " +
          (difficultyChange >= 0 ? "harder" : "easier") +
          " than the historical average.",
      );
    if (current.baselineGap !== null)
      narrative.push(
        "Routine shots were " +
          Math.abs(current.baselineGap).toFixed(1) +
          " percentage points " +
          (current.baselineGap >= 0 ? "above" : "below") +
          " their baseline. " +
          (current.baselineGap < 0
            ? "Routine execution is an area to review, even when the overall shot mix is difficult."
            : "Routine execution held up against previous events."),
      );
    else
      narrative.push(
        "A routine comparison is unavailable because current or historical Easy ratings are missing.",
      );
    text(narrative.join(" "));
    text(
      "Difficulty index uses Easy=1, Moderate=2, Difficult=3. 100 is the shot-weighted season average through this report; every event uses the same reference. This compares recorded ratings, not opponent strength.",
    );
    heading("Routine shooting by game");
    table(
      [
        "Game / opponent",
        "Routine shots",
        "Routine %",
        "Prior routine %",
        "Gap (pp)",
      ],
      current.games.map((g) => [
        `${g.name} · ${g.opponent ?? ""}`,
        String(g.routineShots),
        percentage(g.routinePercent),
        percentage(g.expectedRoutinePercent),
        g.baselineGap === null
          ? g.routineShots
            ? "No prior baseline"
            : "Not measured"
          : `${g.baselineGap >= 0 ? "+" : ""}${g.baselineGap.toFixed(1)}`,
      ]),
      [62, 26, 28, 30, 32],
    );
    heading("Shot difficulty by game");
    table(
      ["Game / opponent", "Difficulty index", "Rated shots"],
      current.games.map((g) => [
        `${g.name} · ${g.opponent ?? ""}`,
        relativeDifficulty(g)?.toFixed(1) ?? "Not measured",
        String(g.ratedShots),
      ]),
      [100, 43, 35],
    );

    text(
      "Full-season trends through this event, with one point per event.",
      8,
      true,
    );
    const series = (
      title: string,
      value: (p: typeof current) => number | null,
      count: (p: typeof current) => number,
      unit = "%",
      minimum = 0,
      maximum = 100,
      secondary?: (p: typeof current) => number | null,
      valueLabel = "Rate",
      reference?: number,
    ) => {
      heading(title, false, true);
      for (let offset = 0; offset < points.length; offset += 8) {
        const group = points.slice(offset, offset + 8);
        blocks.push({
          kind: "trend",
          valueLabel,
          reference,
          firstGame: offset + 1,
          eventLabels: group.map((_, i) => `Event ${offset + i + 1}`),
          rows: group.map((p, i) => [
            `${offset + i + 1}. ${p.name}\n${p.date ?? ""}`,
            value(p) === null
              ? "—"
              : `${value(p)!.toFixed(1)}${unit}` +
                (secondary
                  ? ` / ${secondary(p) === null ? "—" : secondary(p)!.toFixed(1) + "/100"}`
                  : ""),
            count(p) === 0 && p.estimatedShots && title.startsWith("Routine")
              ? "—"
              : String(count(p)),
          ]),
          secondary: secondary ? group.map(secondary) : undefined,
          minimum,
          maximum,
          unit,
          games: group.map((p) => ({
            label: p.name,
            percent: value(p),
            graded: count(p),
            shots: count(p),
          })),
        });
      }
    };
    series(
      "Shooting percentage by event",
      (p) => p.percent,
      (p) => p.graded,
      "%",
      0,
      100,
      undefined,
      "Shooting %",
    );
    series(
      "Routine shooting by event",
      (p) => p.routinePercent,
      (p) => p.routineShots,
      "%",
      0,
      100,
      undefined,
      "Routine %",
    );
    series(
      "Routine baseline gap by event",
      (p) => p.baselineGap,
      (p) => p.routineShots,
      " pp",
      Math.min(-10, ...points.map((p) => p.baselineGap ?? 0)),
      Math.max(10, ...points.map((p) => p.baselineGap ?? 0)),
      undefined,
      "Gap (pp)",
      0,
    );
    text(
      "Routine counts are observed Easy shots. A missing gap with routine shots means no earlier routine baseline. A dash in Shots means only calibrated estimates are available; it does not mean no routine shots were played.",
    );
    const indices = points
      .map(relativeDifficulty)
      .filter((v): v is number => v !== null);
    const span = Math.max(
      20,
      Math.ceil(Math.max(...indices.map((v) => Math.abs(v - 100)), 0) / 10) *
        10,
    );
    series(
      "Season difficulty index by event",
      relativeDifficulty,
      (p) => p.ratedShots,
      "",
      Math.max(0, 100 - span),
      100 + span,
      undefined,
      "Index",
      100,
    );
    const types = [...new Set(points.flatMap((p) => Object.keys(p.byType)))]
      .flatMap((type) => {
        const measured = points.filter(
          (p) => (p.byType[type]?.graded ?? 0) > 0,
        );
        return measured.length >= 2
          ? [
              {
                type,
                change:
                  measured.at(-1)!.byType[type].percent! -
                  measured[0].byType[type].percent!,
              },
            ]
          : [];
      })
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change))
      .slice(0, 5);
    if (!types.length)
      text("Not enough comparable event data for shot-type trends yet.");
    for (const { type } of types)
      series(
        `${type} across events`,
        (p) => p.byType[type]?.percent ?? null,
        (p) => p.byType[type]?.graded ?? 0,
      );
  }
  const shots = stats.filter((m) => m.id.startsWith("type-"));
  const analysis = report.analysis;
  if (analysis) {
    findings();
    heading("Shot Tracker analysis");
    text(
      "These statistics use the latest charted shots in this event. The saved assessment reflects the shots available when it was written.",
      8,
      true,
    );
    const shooting = (
      title: string,
      label: string,
      rows: ShootingRow[],
      empty: string,
    ) => {
      heading(title);
      if (!rows.length) {
        text(empty);
        return;
      }
      table(
        [label, "Shooting %", "Graded / charted shots"],
        rows.map((row) => [
          row.label,
          percentage(row.percent),
          `${row.graded} / ${row.shots}`,
        ]),
        [72, 45, 61],
        "shooting",
      );
    };
    shooting("Performance overview", "Measure", analysis.overview, "");
    const recorded = analysis.execution.reduce(
      (sum, outcome) => sum + outcome.count,
      0,
    );
    const attempts = analysis.overview[0].shots;
    text(`Execution outcomes recorded for ${recorded} of ${attempts} shots.`);
    table(
      ["Execution outcome", "Count"],
      [
        ...analysis.execution,
        { label: "Not recorded", count: attempts - recorded },
      ].map(({ label, count }) => [label, String(count)]),
      [113, 65],
    );
    heading("Performance over time");
    for (let index = 0; index < analysis.games.length; index += 8) {
      const games = analysis.games.slice(index, index + 8);
      if (games.some((game) => game.percent !== null))
        blocks.push({
          kind: "trend",
          games,
          firstGame: index + 1,
          rows: games.map((g) => [
            g.label,
            percentage(g.percent),
            String(g.graded),
          ]),
        });
    }
    if (!analysis.games.length) text("No games available.");
    shooting(
      "Performance by shot",
      "Shot type",
      analysis.shotTypes,
      "No recorded shot types.",
    );
    shooting(
      "Performance by turn",
      "Turn / target",
      analysis.turns,
      "No recorded turns.",
    );
  } else if (!report.highlights && shots.length) {
    heading("Shot execution");
    table(
      ["Shot type", "Shooting %", "Sample / points"],
      shots.map((m) => [m.label, m.value, m.basis]),
      [65, 33, 80],
    );
  }
  const m =
    analysis?.misses ?? (!report.highlights ? report.misses : undefined);
  if (m) {
    heading("Miss diagnosis");
    text(m.focus);
    text(m.definition, 8, true);
    const categoryRows = [
      ...m.categories
        .filter((c) => c.count)
        .map((c) => [c.tag, countPercent(c.percent, c.count, m.misses)]),
      ...(m.untaggedPercent
        ? [
            [
              "Not tagged",
              countPercent(m.untaggedPercent, m.misses - m.tagged, m.misses),
            ],
          ]
        : []),
    ];
    if (analysis) {
      const complete =
        analysis.execution.find((outcome) => outcome.label === "Miss")?.count ??
        0;
      text(
        `Partial, limited or missed: ${countPercent(m.rate, m.misses, m.classified)}. Complete misses: ${complete}. Usable miss tags: ${m.tagged} of ${m.misses}.`,
      );
    }
    if (!analysis || categoryRows.length)
      table(
        ["Recorded miss category", "Share of miss outcomes"],
        categoryRows,
        [113, 65],
      );
    if (m.byShot.length) {
      heading("Where misses concentrate");
      table(
        ["Shot type", "Miss rate", "Most frequent tag / share"],
        m.byShot.map((r) => [
          r.label + (r.smallSample ? " *" : ""),
          countPercent(r.rate, r.misses, r.attempts),
          r.topTag +
            (r.topTag !== "Not tagged"
              ? ` (${r.topCount === undefined ? percentage(r.topPercent) : countPercent(r.topPercent, r.topCount, r.misses)})`
              : ""),
        ]),
        [66, 30, 82],
      );
      text(
        "Miss rate uses classified outcomes for that shot type; tag share uses its miss outcomes. Tied tags are shown together. * Fewer than ten classified outcomes: review cautiously.",
        8,
        true,
      );
    }
    if (m.byTurn?.length) {
      heading("Miss rate by turn");
      table(
        ["Turn", "Miss rate"],
        m.byTurn.map((turn) => [
          turn.label + (turn.smallSample ? " *" : ""),
          countPercent(turn.rate, turn.misses, turn.attempts),
        ]),
        [55, 34],
        "paired",
      );
    }
    if (m.byGame.length && (analysis || !report.games?.length)) {
      heading("Miss rate across games");
      table(
        ["Game", "Miss rate", "Most frequent tag"],
        m.byGame.map((r) => [
          r.label + (r.smallSample ? " *" : ""),
          countPercent(r.rate, r.misses, r.attempts),
          r.topTag,
        ]),
        [55, 40, 83],
      );
    }
  }
  const technical =
    analysis?.technical ?? (!report.highlights ? report.technical : undefined);
  if (technical?.some((g) => g.recorded > 0)) {
    heading("Technical review");
    text(
      "Each share uses observations recorded for that field. Miss rates use classified execution outcomes with that observation. Missing labels are not successful deliveries.",
      8,
      true,
    );
    table(
      analysis
        ? ["Observation", "Share of recorded", "Shooting %", "Miss rate"]
        : ["Observation", "Share of recorded", "Miss rate"],
      technical.flatMap((group) =>
        group.rows
          .filter((r) => r.count > 0)
          .map((r) => [
            `${group.title}: ${r.label}`,
            countPercent(r.percent, r.count, group.recorded),
            ...(analysis
              ? [countPercent(r.shooting, r.points, r.graded * 5)]
              : []),
            countPercent(r.missPercent, r.misses, r.classified),
          ]),
      ),
      analysis ? [52, 45, 41, 40] : [54, 62, 62],
    );
  } else if (analysis) {
    heading("Technical review");
    text("No technical observations were recorded.");
  }
  const advancedTables = (
    summary?: import("./advanced-report").AdvancedReport,
  ) => {
    if (!summary) return;
    heading("Advanced analytics");
    text(
      `${summary.recorded} of ${summary.included} included shots have validated Enhanced records. ${summary.unavailable} unavailable; ${summary.needsReview} need review. Shares use assessed observations; multiple tags may overlap.`,
      8,
      true,
    );
    for (const group of summary.groups) {
      heading(group.title);
      table(
        ["Measurement", "Result / basis"],
        group.metrics.map((m) => [
          m.label,
          reportDifficultyEvidenceText(m.value) +
            (m.sample < 10
              ? " * Small sample"
              : m.sample < 20
                ? " * Tentative"
                : ""),
        ]),
        [90, 88],
      );
    }
  };
  if (!analysis) findings();
  if (!report.highlights) advancedTables(report.advanced);
  if (!report.highlights && report.games?.length) {
    for (const game of report.games) {
      heading(`Game-by-game review: ${game.title}`, true);
      const summary = report.narrative.games?.find((g) => g.key === game.key);
      if (summary) text(summary.text);
      if (game.difficulty) text(difficultyDescription(game.difficulty));
      advancedTables(game.advanced);
      const metrics = game.groups.flatMap((group) =>
        group.metrics.map((m) => [
          `${group.title}: ${m.label}${m.value === "—" ? "" : "\n" + (m.basis ? basisText(m.basis) : report.evidence.find((e) => e.id === m.id) ? evidenceBasis(report.evidence.find((e) => e.id === m.id)!) : "Sample unavailable")}`,
          m.value === "—" ? "-" : m.value,
        ]),
      );
      table(["Measurement", "Result"], metrics, [70, 19], "paired");
    }
  }
  if (report.flags?.length) {
    heading(
      report.flags.some((flag) => flag.shooter)
        ? "Team flagged shots"
        : "Your flagged shots",
    );
    for (const flag of report.flags) blocks.push({ kind: "flag", flag });
  } else if (analysis && report.playerId) {
    heading("Your flagged shots");
    text("No flagged shots for this player.");
  }
  if (analysis || !report.highlights) {
    heading("Report legend");
    table(
      ["Code / measure", "Meaning"],
      reportLegend.map(([code, meaning]) => [code, meaning]),
      [44, 134],
    );
  }
  heading("How to use this report");
  text(
    "These are observations from charted shots. Shot difficulty, ice and tactical intent can affect results. Review video and coaching observations before attributing a miss to a technical cause. Shooting percentages use the recorded scoring scale; they are not Curling Canada benchmarks.",
    8,
    true,
  );
  return blocks;
}
