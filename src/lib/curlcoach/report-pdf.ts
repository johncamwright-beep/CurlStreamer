import type { SavedReport } from "./reports";
import { reportPercentages, reportSections } from "./report-presentation";

/** Local export of the selected saved report; no AI request or remote upload. */
export async function downloadReportPDF(
  report: SavedReport,
  eventName: string,
) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  pdf.setProperties({
    title: `${report.title} — ${eventName}`,
    author: "Shot Tracker",
  });
  let y = 22;
  const clean = (s: string) =>
    s
      .normalize("NFKC")
      .replace(/[–—]/g, "-")
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
  const write = (text: string, size = 11, bold = false) => {
    pdf.setFont("helvetica", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(clean(text), 170) as string[];
    for (const line of lines) {
      if (y > 272) {
        pdf.addPage();
        y = 22;
      }
      pdf.text(line, 20, y);
      y += size * 0.46;
    }
    y += 3;
  };
  write(report.title, 20, true);
  write(eventName, 11);
  y += 3;
  for (const metric of reportPercentages(report))
    write(
      `${metric.label}: ${metric.value}`,
      metric.id === "overall" ? 16 : 11,
      metric.id === "overall",
    );
  for (const section of reportSections(report)) {
    if (y > 247) {
      pdf.addPage();
      y = 22;
    }
    y += 5;
    write(section.title, 14, true);
    for (const finding of section.findings) write(finding.text);
  }
  for (const game of report.games ?? []) {
    if (y > 180) {
      pdf.addPage();
      y = 22;
    }
    y += 5;
    write(game.title, 14, true);
    for (const group of game.groups) {
      write(group.title, 10, true);
      write(
        group.metrics
          .map(
            (m) => `${m.label}: ${m.value === "—" ? "not measured" : m.value}`,
          )
          .join(" | "),
        9,
      );
    }
    const summary = report.narrative.games?.find((g) => g.key === game.key);
    if (summary) write(summary.text);
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setFontSize(9);
    pdf.setFont("helvetica", "normal");
    pdf.text(`Shot Tracker | ${page} / ${pdf.getNumberOfPages()}`, 20, 286);
  }
  pdf.save(
    `${eventName}-${report.title}.pdf`.replace(
      /[<>:"/\\|?*\u0000-\u001f]/g,
      "-",
    ),
  );
}
