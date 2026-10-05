import type { SavedReport } from "./reports";

/** Keep source counts for validation, but show only useful shooting percentages. */
export function reportPercentages(report: SavedReport) {
  return report.evidence.flatMap((e) => {
    if (e.id !== "overall" && !e.id.startsWith("type-")) return [];
    const percent = e.value.match(/^\d+(?:\.\d+)?%/);
    return percent
      ? [
          {
            id: e.id,
            label: e.id === "overall" ? "Overall shooting" : e.label,
            value: percent[0],
          },
        ]
      : [];
  });
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
    { title: "Next practice", findings: report.narrative.practice },
  ].map((section) => ({
    ...section,
    findings: section.findings.map((finding) => ({
      ...finding,
      text: finding.text.replace(
        /\bPlayer [A-H]\b/g,
        (alias) => names.get(alias) ?? alias,
      ),
    })),
  }));
}
