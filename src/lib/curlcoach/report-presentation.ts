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
  return [
    { title: "Overall", findings: [report.narrative.summary] },
    { title: "What went well", findings: report.narrative.strengths },
    { title: "Where to improve", findings: report.narrative.priorities },
    { title: "Next practice", findings: report.narrative.practice },
  ];
}
