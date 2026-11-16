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
  function heading(title: string, minimum = 55) {
    ensure(minimum);
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
  for (let offset = 0; offset < cards.length; offset += 2) {
    const row = cards.slice(offset, offset + 2);
    ensure(43);
    const cw = (width - 5) / 2;
    row.forEach((c, i) => {
      const x = margin + i * (cw + 5);
      pdf.setFillColor(pale);
      pdf.roundedRect(x, y, cw, 39, 2, 2, "F");
      pdf.setFont("ReportSans", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(muted);
      pdf.text(pdf.splitTextToSize(c.label, cw - 8), x + 4, y + 7);
      pdf.setFont("ReportSans", "bold");
      pdf.setFontSize(18);
      pdf.setTextColor(ink);
      pdf.text(c.value, x + 4, y + 21);
      pdf.setFont("ReportSans", "normal");
      pdf.setFontSize(8);
      pdf.text(pdf.splitTextToSize(c.basis, cw - 8), x + 4, y + 29);
      if ("difficulty" in c && typeof c.difficulty === "number") {
        for (let step = 0; step < 24; step++) {
          pdf.setFillColor(
            Math.round(40 + step * 7),
            Math.round(175 - step * 5),
            70,
          );
          pdf.rect(x + cw - 12, y + 31 - step, 3, 1.1, "F");
        }
        const markerY = y + 31 - (c.difficulty * 23) / 100;
        pdf.setFillColor(ink);
        pdf.triangle(
          x + cw - 7,
          markerY,
          x + cw - 4,
          markerY - 1.5,
          x + cw - 4,
          markerY + 1.5,
          "F",
        );
        pdf.setFontSize(6);
        pdf.text("Difficult", x + cw - 18, y + 5);
        pdf.text("Easy", x + cw - 12, y + 36);
      }
      if ("direction" in c && c.direction) {
        pdf.setFillColor(c.direction > 0 ? "#CE3434" : "#18824A");
        const ay = y + 18;
        const ax = x + cw - 10;
        pdf.triangle(
          ax,
          ay + (c.direction > 0 ? -3 : 3),
          ax - 2,
          ay,
          ax + 2,
          ay,
          "F",
        );
      }
    });
    y += 43;
  }
  for (const block of reportContent(report)) {
    switch (block.kind) {
      case "heading":
        if (block.startPage) {
          pdf.addPage();
          header();
        }
        heading(block.title, block.keepWithChart ? 75 : 55);
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
        const compact = !!block.rows;
        const rowHeights =
          block.rows?.map(
            (r) =>
              Math.max(
                ...r.map((v, i) => lines(v, 7, [57, 27, 12][i] - 3).length),
              ) *
                3.4 +
              3,
          ) ?? [];
        const height = compact
          ? Math.max(49, 10 + rowHeights.reduce((n, v) => n + v, 0))
          : 49;
        ensure(height + 4);
        const start = y;
        if (compact) {
          pdf.setDrawColor("#CBD8DE");
          pdf.setLineWidth(0.2);
          pdf.roundedRect(margin - 2, start - 2, width + 4, height + 4, 2, 2);
        }
        const plotX = margin + 11,
          plotWidth = compact ? 61 : width - 22;
        const min = block.minimum ?? 0,
          max = block.maximum ?? 100;
        const at = (v: number) => start + 38 - (30 * (v - min)) / (max - min);
        pdf.setFont("ReportSans", "normal");
        pdf.setFontSize(7);
        pdf.setTextColor(muted);
        pdf.setDrawColor("#CBD8DE");
        pdf.setLineWidth(0.2);
        for (const v of [max, (min + max) / 2, min]) {
          pdf.line(plotX, at(v), plotX + plotWidth, at(v));
          pdf.text(v.toFixed(0) + (block.unit ?? "%"), plotX - 2, at(v) + 1, {
            align: "right",
          });
        }
        const points = reportTrendPoints(block.games);
        points.forEach((p, i) =>
          pdf.text(
            compact
              ? String(block.firstGame + i)
              : (block.eventLabels?.[i] ?? "Game " + (block.firstGame + i)),
            plotX + plotWidth * p.x,
            start + 44,
            { align: "center" },
          ),
        );
        const drawSeries = (values: (number | null)[], color: string) => {
          let previous: { x: number; value: number } | null = null;
          pdf.setDrawColor(color);
          pdf.setFillColor(color);
          pdf.setLineWidth(0.6);
          values.forEach((value, i) => {
            if (value === null) return;
            const x = plotX + plotWidth * points[i].x;
            if (previous)
              pdf.line(previous.x, at(previous.value), x, at(value));
            pdf.circle(x, at(value), 0.9, "F");
            previous = { x, value };
          });
        };
        drawSeries(
          points.map((p) => p.value),
          "#087D90",
        );
        if (block.secondary) {
          drawSeries(block.secondary, "#CE3434");
          pdf.setFontSize(6);
          pdf.setTextColor("#087D90");
          pdf.text("Shooting %", plotX, start + 2);
          pdf.setTextColor("#CE3434");
          pdf.text("Difficulty (Easy 0 - Difficult 100)", plotX, start + 6);
        }
        if (block.rows) {
          const tx = margin + 82,
            widths = [57, 27, 12];
          let ry = start;
          pdf.setFillColor(navy);
          pdf.rect(tx, ry, 96, 7, "F");
          pdf.setTextColor("#FFFFFF");
          pdf.setFontSize(7);
          [
            "Event",
            block.secondary ? "Shot / difficulty" : "Rate",
            "Shots",
          ].forEach((v, i) =>
            pdf.text(
              v,
              tx + widths.slice(0, i).reduce((n, v) => n + v, 0) + 1,
              ry + 4,
            ),
          );
          ry += 7;
          block.rows.forEach((row, i) => {
            pdf.setTextColor(ink);
            let x = tx;
            row.forEach((value, j) => {
              pdf.text(lines(value, 7, widths[j] - 3), x + 1, ry + 4, {
                lineHeightFactor: 1.35,
              });
              x += widths[j];
            });
            ry += rowHeights[i];
            pdf.setDrawColor("#CBD8DE");
            pdf.setLineWidth(0.2);
            pdf.line(tx, ry, tx + 96, ry);
          });
        }
        y = start + height + 4;
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
