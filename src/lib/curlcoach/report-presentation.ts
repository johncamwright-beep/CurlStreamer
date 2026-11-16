import type { SavedReport } from "./reports";
import { evidenceBasis } from "./report-counts";
import type { DifficultySummary } from "./difficulty";

/** Only rated shots receive the Easy-reference uplift; unrated shots retain their actual grade. */
export function adjustedReportPercentage(
  overall: number,
  difficulty: DifficultySummary,
) {
  const uplift = Math.max(
    0,
    difficulty.benchmarks.expected.A -
      (difficulty.expected ?? difficulty.benchmarks.expected.A),
  );
  return Math.min(
    100,
    overall +
      (uplift * difficulty.classified) / Math.max(1, difficulty.eligible),
  );
}

/** Older evidence strings contain a redundant index on the moderate reference. */
export function reportDifficultyEvidenceText(value: string) {
  return value
    .replace(/^Difficulty adjusted: (?:-?\d+(?:\.\d+)?%|N\/A) \u00b7 /, "")
    .replace(/; reference baseline \d+(?:\.\d+)?%\./, ".")
    .replace(/; adjusted -?\d+(?:\.\d+)?%(?=;)/, "");
}

/** Keep source counts for validation, but show only useful shooting percentages. */
export function reportPercentages(report: SavedReport) {
  const values = report.evidence.flatMap((e) => {
    if (e.id !== "overall" && !e.id.startsWith("type-")) return [];
    const percent = e.value.match(/^\d+(?:\.\d+)?%/);
    return percent
      ? [
          {
            id: e.id,
            label: e.id === "overall" ? "Overall shooting percentage" : e.label,
            value: percent[0],
            basis:
              e.id === "overall"
                ? `${e.basis?.shots ?? e.sample} shots charted`
                : evidenceBasis(e),
          },
        ]
      : [];
  });
  if (report.difficulty && report.difficulty.pae !== null)
    values.push({
      id: "adjusted",
      label: "Difficulty adjusted shooting percentage",
      value: `${adjustedReportPercentage(Number.parseFloat(values.find((v) => v.id === "overall")?.value ?? "0"), report.difficulty).toFixed(1)}%`,
      basis: `${report.difficulty.classified} of ${report.difficulty.eligible} graded shots with difficulty${report.difficulty.estimated ? ` · ${report.difficulty.estimated} estimated` : ""}`,
    });
  return values;
}
export function reportSections(report: SavedReport) {
  const names = new Map(
    report.evidence.flatMap((e) => {
      if (!e.id.startsWith("player-")) return [];
      const match = e.label.match(/^(Player [A-H]) · (.+)$/);
      return match ? [[match[1], match[2]] as const] : [];
    }),
  );
  return [
    { title: "Overall", findings: [report.narrative.summary] },
    { title: "What went well", findings: report.narrative.strengths },
    { title: "Where to improve", findings: report.narrative.priorities },
    {
      title: "Opening to closing ends",
      findings: report.narrative.withinGames ?? [],
    },
    {
      title: "Changes across the event",
      findings: report.narrative.acrossGames ?? [],
    },
    {
      title: "Next practice",
      findings:
        !report.highlights &&
        report.misses?.practice.length &&
        !report.advanced?.recorded &&
        !report.technical?.some((g) => g.recorded > 0)
          ? report.misses.practice.map((p) => ({
              text: `${p.title} (focus: ${p.target}): ${p.setup} Check progress: ${p.measure}`,
              evidence: [`miss-${p.tag}`],
            }))
          : report.narrative.practice,
    },
  ]
    .filter((section) => section.findings.length)
    .map((section) => ({
      ...section,
      findings: section.findings.map((finding) => ({
        ...finding,
        statistics: finding.evidence
          .flatMap((id) => {
            const e = report.evidence.find((e) => e.id === id);
            if (id.startsWith("trend-") || id.includes("difficulty"))
              return e
                ? [
                    {
                      label: e.label,
                      value: reportDifficultyEvidenceText(
                        e.value.split("Provisional illustrative")[0],
                      ),
                    },
                  ]
                : [];
            const value = e?.value.match(/\d+(?:\.\d+)?%/)?.[0];
            return e && value
              ? [
                  {
                    label: e.label.replace(
                      /\bPlayer [A-H]\b/g,
                      (alias) => names.get(alias) ?? alias,
                    ),
                    value: `${value} (${evidenceBasis(e)})`,
                  },
                ]
              : [];
          })
          .slice(0, 2),
        text: finding.text.replace(
          /\bPlayer [A-H]\b/g,
          (alias) => names.get(alias) ?? alias,
        ),
      })),
    }));
}
