import { expect, it } from "vitest";
import { sampleEvent } from "./event";
import { reportInputs } from "./reports";
import { basisText, countPercent, evidenceBasis } from "./report-counts";
import { reportLegend } from "./report-legend";
it("distinguishes grade points from binary completions and preserves real sample sizes", () => {
  expect(
    basisText({ numerator: 45, denominator: 50, unit: "points", shots: 10 }),
  ).toBe("45 of 50 points; 10 shots");
  expect(countPercent(90, 9, 10)).toBe("90.0% (9 of 10)");
  expect(countPercent(null, 0, 0)).toBe("Not measured");
  for (const report of reportInputs(sampleEvent("shorty-example"), "players")) {
    const overall = report.evidence.find((e) => e.id === "overall")!;
    expect(overall.basis!.denominator).toBe(overall.sample * 5);
    expect(overall.basis!.shots).toBe(overall.sample);
    expect(evidenceBasis(overall)).toContain("points");
    for (const g of report.games!)
      for (const group of g.groups)
        for (const m of group.metrics) {
          expect(m.basis).toBeDefined();
          expect(m.basis!.numerator).toBeLessThanOrEqual(m.basis!.denominator);
        }
  }
  expect(reportLegend.map(([code]) => code)).toEqual(
    expect.arrayContaining(["CW", "CCW", "C", "S", "IO / I-O", "CCW-S", "W"]),
  );
});
