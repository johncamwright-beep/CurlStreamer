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
    {
      title: "Next practice",
      findings: report.misses?.practice.length
        ? report.misses.practice.map((p) => ({
            text: `${p.title} (focus: ${p.target}): ${p.setup} Check progress: ${p.measure}`,
            evidence: [`miss-${p.tag}`],
          }))
        : report.narrative.practice,
    },
  ].map((section) => ({
    ...section,
    findings: section.findings.map((finding) => ({
      ...finding,
      statistics: finding.evidence
        .flatMap((id) => {
          const e = report.evidence.find((e) => e.id === id);
          const value = e?.value.match(/\d+(?:\.\d+)?%/)?.[0];
          return e && value
            ? [
                {
                  label: e.label.replace(
                    /\bPlayer [A-H]\b/g,
                    (alias) => names.get(alias) ?? alias,
                  ),
                  value,
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
