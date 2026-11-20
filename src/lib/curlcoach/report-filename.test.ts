import { expect, it } from "vitest";
import { reportPDFFilename, reportPDFTitle } from "./report-filename";
it("names team, coach and player PDFs with the event first", () => {
  expect(
    reportPDFFilename({ key: "team", title: "Team report" }, "Rideau Trillium"),
  ).toBe("Rideau Trillium - Team Report.pdf");
  expect(
    reportPDFFilename(
      { key: "coach", title: "Coach report" },
      "Rideau Trillium",
    ),
  ).toBe("Rideau Trillium - Coach Report.pdf");
  const player = { key: "player-1", title: "Owen MacTavish" };
  expect(reportPDFTitle(player, "Rideau Trillium")).toBe(
    "Rideau Trillium - Owen MacTavish - Report",
  );
  expect(reportPDFFilename(player, "Rideau Trillium")).toBe(
    "Rideau Trillium - Owen MacTavish - Report.pdf",
  );
});
it("preserves readable Unicode names while removing unsafe filename characters", () => {
  const name = reportPDFFilename(
    { key: "player-1", title: "Émile / Roy" },
    'Event: "Final"',
  );
  expect(name).toContain("Émile - Roy");
  expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
  expect(
    reportPDFFilename({ key: "team", title: "Team report" }, "x".repeat(500)),
  ).toHaveLength(184);
});
