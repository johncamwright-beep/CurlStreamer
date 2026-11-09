import {
  difficultyCaveat,
  difficultyDescription,
  difficultyPercent,
  type DifficultySummary,
} from "./difficulty";
import type { SavedReport } from "./reports";
import type { ReportFlag } from "./flagged-shots";
import {
  reportDifficultyEvidenceText,
  reportPercentages,
  reportSections,
} from "./report-presentation";
import { reportLegend } from "./report-legend";
import { basisText, countPercent, evidenceBasis } from "./report-counts";
import type { ShootingRow } from "./report-analysis";

type ReportBlock =
  | { kind: "heading"; title: string; startPage: boolean }
  | { kind: "text"; value: string; size: number; muted: boolean }
  | {
      kind: "table";
      headers: string[];
      rows: string[][];
      widths: number[];
      layout?: "paired" | "shooting";
    }
  | { kind: "trend"; games: ShootingRow[]; firstGame: number }
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

export function reportSummaryCards(report: SavedReport) {
  const stats = reportPercentages(report);
  return [
    ...stats
      .filter((m) => m.id === "overall" || m.id === "adjusted")
      .map((m) => ({ label: m.label, value: m.value, basis: m.basis })),
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
  const blocks: ReportBlock[] = [];
  const stats = reportPercentages(report);
  const heading = (title: string, startPage = false) => {
    blocks.push({ kind: "heading", title, startPage });
  };
  const text = (value: string, size = 10, muted = false) => {
    blocks.push({ kind: "text", value, size, muted });
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
    for (const section of sections.slice(1)) {
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
        blocks.push({ kind: "trend", games, firstGame: index + 1 });
    }
    if (analysis.games.length)
      table(
        ["Game", "Shooting %", "Graded / charted shots"],
        analysis.games.map((game, index) => [
          `Game ${index + 1}${game.label === `Game ${index + 1}` ? "" : ` · ${game.label}`}`,
          percentage(game.percent),
          `${game.graded} / ${game.shots}`,
        ]),
        [88, 37, 53],
      );
    else text("No games available.");
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
