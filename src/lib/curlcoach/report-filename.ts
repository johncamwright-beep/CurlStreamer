import type { SavedReport } from "./reports";

export function reportPDFTitle(
  report: Pick<SavedReport, "key" | "title">,
  eventName: string,
) {
  const label =
    report.key === "team"
      ? "Team Report"
      : report.key === "coach"
        ? "Coach Report"
        : `${report.title.trim()} - Report`;
  return `${eventName.trim()} - ${label}`;
}

export function reportPDFFilename(
  report: Pick<SavedReport, "key" | "title">,
  eventName: string,
) {
  return `${reportPDFTitle(report, eventName)
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180)
    .replace(/[. ]+$/, "")}.pdf`;
}
