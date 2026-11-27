import { expect, it } from "vitest";
import {
  adjustedReportPercentage,
  reportPercentages,
  reportSections,
} from "./report-presentation";
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
  expect(
    "summary" in report.narrative && report.narrative.summary.text,
  ).toContain("Player A");
  report.evidence = [];
  expect(reportSections(report)[0].findings[0].text).toContain("Player A");
});

it("difficulty adjustment never penalizes easy or unrated shots and caps at 100", () => {
  const base = {
    benchmarks: { expected: { A: 85, B: 70, C: 55 } },
    expected: 55,
    classified: 5,
    eligible: 10,
  } as import("./difficulty").DifficultySummary;
  expect(adjustedReportPercentage(70, base)).toBe(85);
  expect(adjustedReportPercentage(95, base)).toBe(100);
  expect(adjustedReportPercentage(70, { ...base, expected: 85 })).toBe(70);
  expect(
    adjustedReportPercentage(70, { ...base, classified: 0, expected: null }),
  ).toBe(70);
});
