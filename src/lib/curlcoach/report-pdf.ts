import type { SavedReport } from "./reports";
import { reportPDFFilename, reportPDFTitle } from "./report-filename";
export { reportPDFFilename } from "./report-filename";
import {
  reportContent,
  reportSummaryCards,
  reportTrendPoints,
} from "./report-content";
import { reportLogo } from "./report-logo";
import { reportFontRegular, reportFontBold } from "./report-fonts";
const clean = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
/** Shared browser/server layout. All assets are local; no remote uploads or fetches. */
export async function buildReportPDF(report: SavedReport, eventName: string) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", putOnlyUsedFonts: true });
  pdf.addFileToVFS("Vera.ttf", reportFontRegular);
  pdf.addFont("Vera.ttf", "ReportSans", "normal");
  pdf.addFileToVFS("VeraBd.ttf", reportFontBold);
  pdf.addFont("VeraBd.ttf", "ReportSans", "bold");
  const navy = "#0D1B2A",
    cyan = "#13B8CE",
    ink = "#172C3E",
    muted = "#526574",
    pale = "#F0F6F8";
  const margin = 16,
    width = 178,
    bottom = 274;
  let y = 49;
  function header() {
    pdf.setFillColor(navy);
    pdf.rect(0, 0, 210, 37, "F");
    pdf.addImage(reportLogo, "PNG", 16, 9, 67, 16.75, undefined, "FAST");
    pdf.setFont("ReportSans", "bold");
    pdf.setFontSize(10);
    pdf.setTextColor("#FFFFFF");
    pdf.text("SHOT TRACKER", 194, 18, { align: "right" });
    pdf.setFont("ReportSans", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor("#B7D9E2");
    pdf.text("EVENT PERFORMANCE REPORT", 194, 24, { align: "right" });
    pdf.setFillColor(cyan);
    pdf.rect(0, 37, 210, 1.5, "F");
    y = 49;
  }
  function ensure(h: number) {
    if (y + h > bottom) {
      pdf.addPage();
      header();
    }
  }
  function lines(value: string, size: number, w = width, bold = false) {
    pdf.setFont("ReportSans", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    return pdf.splitTextToSize(clean(value), w) as string[];
  }
  function text(
    value: string,
    size = 10,
    bold = false,
    color = ink,
    w = width,
    x = margin,
  ) {
    const rows = lines(value, size, w, bold),
      step = size * 0.46;
    if (rows.length * step + 3 < bottom - 49) ensure(rows.length * step + 3);
    for (const line of rows) {
      ensure(step + 1);
      pdf.setFont("ReportSans", bold ? "bold" : "normal");
      pdf.setFontSize(size);
      pdf.setTextColor(color);
      pdf.text(line, x, y);
      y += step;
    }
    y += 3;
  }
  function heading(title: string) {
    ensure(55);
    y += 3;
    pdf.setFillColor(cyan);
    pdf.rect(margin, y - 4, 2, 6, "F");
    text(title, 13, true, ink, width - 6, margin + 6);
    y += 1;
  }
  function table(
    headers: string[],
    rows: string[][],
    widths: number[],
    compact = true,
    shooting = false,
  ) {
    const lineHeight = compact ? 3.6 : 4.1,
      size = compact ? 8 : 8.5;
    function draw(values: string[], head = false, alternate = false) {
      const wrapped = values.map((v, i) => lines(v, size, widths[i] - 6, head));
      const height =
        Math.max(...wrapped.map((v) => v.length)) * lineHeight +
        (compact ? 4 : 6);
      if (y + height > bottom) {
        pdf.addPage();
        header();
        if (!head) draw(headers, true);
      }
      pdf.setFillColor(head ? navy : alternate ? pale : "#FFFFFF");
      pdf.rect(margin, y, width, height, "F");
      let x = margin;
      wrapped.forEach((parts, i) => {
        pdf.setFont("ReportSans", head ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.setTextColor(head ? "#FFFFFF" : ink);
        parts.forEach((part, j) =>
          pdf.text(part, x + 3, y + (compact ? 4 : 5) + j * lineHeight),
        );
        const percent = Number.parseFloat(values[i]);
        if (shooting && !head && i === 1 && Number.isFinite(percent)) {
          pdf.setFillColor("#CBD8DE");
          pdf.rect(x + 3, y + height - 2, widths[i] - 6, 0.7, "F");
          pdf.setFillColor("#087D90");
          pdf.rect(
            x + 3,
            y + height - 2,
            ((widths[i] - 6) * percent) / 100,
            0.7,
            "F",
          );
        }
        x += widths[i];
      });
      y += height;
    }
    draw(headers, true);
    rows.forEach((row, i) => draw(row, false, i % 2 === 0));
    y += 5;
  }
  header();
  pdf.setProperties({
    title: reportPDFTitle(report, eventName),
    author: "CurlStreamer | Shot Tracker",
  });
  text(report.title, 24, true);
  text(eventName, 12, false, muted);
  y += 3;
  const cards = reportSummaryCards(report);
  if (cards.length) {
    ensure(39);
    const cw = (width - 5 * (cards.length - 1)) / cards.length;
    cards.forEach((c, i) => {
      const x = margin + i * (cw + 5);
      pdf.setFillColor(pale);
      pdf.roundedRect(x, y, cw, 35, 2, 2, "F");
      pdf.setFont("ReportSans", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(muted);
      pdf.text(c.label, x + 4, y + 7);
      pdf.setFont("ReportSans", "bold");
      pdf.setFontSize(20);
      pdf.setTextColor(ink);
      pdf.text(c.value, x + 4, y + 19);
      pdf.setFont("ReportSans", "normal");
      pdf.setFontSize(8);
      pdf.text(pdf.splitTextToSize(c.basis, cw - 8), x + 4, y + 26);
    });
    y += 42;
  }
  for (const block of reportContent(report)) {
    switch (block.kind) {
      case "heading":
        if (block.startPage) {
          pdf.addPage();
          header();
        }
        heading(block.title);
        break;
      case "text":
        text(block.value, block.size, false, block.muted ? muted : ink);
        break;
      case "table":
        if (block.layout === "paired") {
          const paired: string[][] = [];
          for (let i = 0; i < block.rows.length; i += 2) {
            paired.push([...block.rows[i], ...(block.rows[i + 1] ?? ["", ""])]);
          }
          table([...block.headers, ...block.headers], paired, [
            ...block.widths,
            ...block.widths,
          ]);
        } else {
          table(
            block.headers,
            block.rows,
            block.widths,
            true,
            block.layout === "shooting",
          );
        }
        break;
      case "trend": {
        ensure(51);
        const plotX = margin + 12;
        const plotWidth = width - 22;
        const at = (value: number) => y + 40 - value * 0.36;
        pdf.setFont("ReportSans", "normal");
        pdf.setFontSize(8);
        pdf.setTextColor(muted);
        pdf.setDrawColor("#CBD8DE");
        pdf.setLineWidth(0.25);
        for (const value of [100, 50, 0]) {
          pdf.line(plotX, at(value), plotX + plotWidth, at(value));
          pdf.text(String(value) + "%", plotX - 2, at(value) + 1, {
            align: "right",
          });
        }
        const points = reportTrendPoints(block.games);
        pdf.setDrawColor("#087D90");
        pdf.setFillColor("#087D90");
        pdf.setLineWidth(0.7);
        points.forEach((point, index) => {
          const x = plotX + plotWidth * point.x;
          pdf.text(`Game ${block.firstGame + index}`, x, y + 46, {
            align: "center",
          });
          if (point.value === null) return;
          const previous = points[index - 1];
          if (previous && previous.value !== null)
            pdf.line(
              plotX + plotWidth * previous.x,
              at(previous.value),
              x,
              at(point.value),
            );
          pdf.circle(x, at(point.value), 1.3, "F");
        });
        pdf.setLineWidth(0.2);
        y += 51;
        break;
      }
      case "practice":
        ensure(lines(block.text, 10).length * 4.6 + 14);
        text(`Practice ${block.number}`, 10, true);
        text(block.text);
        break;
      case "flag": {
        const { flag } = block;
        ensure(32);
        const shooter = flag.shooter ? `${flag.shooter} | ` : "";
        text(
          `${shooter}${flag.game}${flag.end !== null ? ` | End ${flag.end} | Stone ${flag.stone}` : " | Video review"}`,
          10,
          true,
        );
        text(flag.type, 9, false, muted);
        text(flag.note || "No coach's note added.");
        if (flag.url) {
          ensure(8);
          pdf.setFontSize(10);
          pdf.setTextColor("#087D90");
          pdf.textWithLink(
            `Review video${flag.estimated ? " (approximate timing)" : ""}`,
            margin,
            y,
            { url: flag.url },
          );
          y += 8;
        } else text("Recording unavailable.", 9, false, muted);
        break;
      }
    }
  }
  for (let p = 1; p <= pdf.getNumberOfPages(); p++) {
    pdf.setPage(p);
    pdf.setDrawColor("#CBD8DE");
    pdf.line(margin, 281, 194, 281);
    pdf.setFont("ReportSans", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(muted);
    pdf.text("CurlStreamer | Shot Tracker", margin, 287);
    pdf.text(`${p} / ${pdf.getNumberOfPages()}`, 194, 287, { align: "right" });
  }
  return pdf;
}
export async function downloadReportPDF(
  report: SavedReport,
  eventName: string,
) {
  (await buildReportPDF(report, eventName)).save(
    reportPDFFilename(report, eventName),
  );
}
