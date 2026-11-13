import { expect, it } from "vitest";
import { reportPercentages, reportSections } from "./report-presentation";
import type { SavedReport } from "./reports";
it("shows percentages without audit counts and resolves only authorized named aliases", () => {
  const report: SavedReport = {
    key: "coach",
    title: "Coach report",
    limitations: [],
    evidence: [
      {
        id: "overall",
        label: "Shooting",
        value: "76.3%; 301 graded",
        sample: 301,
        confidence: "event",
      },
      {
        id: "type-0",
        label: "Draw",
        value: "0.0%; 10 graded",
        sample: 10,
        confidence: "tentative",
      },
      {
        id: "player-1",
        label: "Player A · Alex Greenwood",
        value: "80.0%",
        sample: 30,
        confidence: "event",
      },
    ],
    narrative: {
      summary: {
        text: "Review Player A's shots with Player B.",
        evidence: ["player-1"],
      },
      strengths: [],
      priorities: [],
      practice: [],
      review: [],
    },
  };
  expect(reportPercentages(report).map((e) => e.value)).toEqual([
    "76.3%",
    "0.0%",
  ]);
  expect(reportSections(report)[0].findings[0].text).toBe(
    "Review Alex Greenwood's shots with Player B.",
  );
  expect(report.narrative.summary.text).toContain("Player A");
  report.evidence = [];
  expect(reportSections(report)[0].findings[0].text).toContain("Player A");
});
