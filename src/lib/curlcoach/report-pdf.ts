import type { SavedReport } from "./reports";
import { reportPDFFilename, reportPDFTitle } from "./report-filename";
export { reportPDFFilename } from "./report-filename";
import { reportPercentages, reportSections } from "./report-presentation";
import { reportLogo } from "./report-logo";
import { reportFontRegular, reportFontBold } from "./report-fonts";
import { reportLegend } from "./report-legend";
import { basisText, evidenceBasis, countPercent } from "./report-counts";
const clean = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
const percentage = (v: number | null) =>
  v === null ? "Not measured" : `${v.toFixed(1)}%`;
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
  const stats = reportPercentages(report);
  const cards = [
    ...stats
      .filter((m) => m.id === "overall")
      .map((m) => ({ label: m.label, value: m.value, basis: m.basis })),
    ...(report.misses
      ? [
          {
            label: "Partial / limited / miss",
            value: percentage(report.misses.rate),
            basis: `${report.misses.misses} of ${report.misses.classified} shots`,
          },
        ]
      : []),
  ];
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
  const sections = reportSections(report);
  heading("Overall assessment");
  sections[0].findings.forEach((f) => text(f.text));
  const shots = stats.filter((m) => m.id !== "overall");
  if (shots.length) {
    heading("Shot execution");
    table(
      ["Shot type", "Shooting %", "Sample / points"],
      shots.map((m) => [m.label, m.value, m.basis]),
      [65, 33, 80],
    );
  }
  if (report.misses) {
    const m = report.misses;
    heading("Miss diagnosis");
    text(m.focus);
    text(m.definition, 8, false, muted);
    table(
      ["Recorded miss category", "Share of miss outcomes"],
      [
        ...m.categories
          .filter((c) => c.count)
          .map((c) => [c.tag, countPercent(c.percent, c.count, m.misses)]),
        ...(m.untaggedPercent
          ? [
              [
                "Not tagged",
                countPercent(m.untaggedPercent, m.misses - m.tagged, m.misses),
              ],
            ]
          : []),
      ],
      [113, 65],
    );
    if (m.byShot.length) {
      heading("Where misses concentrate");
      table(
        ["Shot type", "Miss rate", "Most frequent tag / share"],
        m.byShot.map((r) => [
          r.label + (r.smallSample ? " *" : ""),
          countPercent(r.rate, r.misses, r.attempts),
          r.topTag +
            (r.topTag !== "Not tagged"
              ? ` (${r.topCount === undefined ? percentage(r.topPercent) : countPercent(r.topPercent, r.topCount, r.misses)})`
              : ""),
        ]),
        [66, 30, 82],
      );
      text(
        "Miss rate uses classified outcomes for that shot type; tag share uses its miss outcomes. Tied tags are shown together. * Fewer than ten classified outcomes: review cautiously.",
        8,
        false,
        muted,
      );
    }
    if (m.byTurn?.length) {
      heading("Miss rate by turn");
      const rows: string[][] = [];
      for (let i = 0; i < m.byTurn.length; i += 2) {
        const a = m.byTurn[i],
          b = m.byTurn[i + 1];
        rows.push([
          a.label + (a.smallSample ? " *" : ""),
          countPercent(a.rate, a.misses, a.attempts),
          b ? b.label + (b.smallSample ? " *" : "") : "",
          b ? countPercent(b.rate, b.misses, b.attempts) : "",
        ]);
      }
      table(
        ["Turn", "Miss rate", "Turn", "Miss rate"],
        rows,
        [55, 34, 55, 34],
        true,
      );
    }
    if (m.byGame.length && !report.games?.length) {
      heading("Miss rate across games");
      table(
        ["Game", "Miss rate", "Most frequent tag"],
        m.byGame.map((r) => [
          r.label + (r.smallSample ? " *" : ""),
          countPercent(r.rate, r.misses, r.attempts),
          r.topTag,
        ]),
        [55, 40, 83],
      );
    }
  }
  for (const section of sections.slice(1)) {
    heading(section.title);
    section.findings.forEach((f, i) => {
      if (section.title === "Next practice") {
        ensure(lines(f.text, 10).length * 4.6 + 14);
        text(`Practice ${i + 1}`, 10, true);
      }
      text(f.text);
      if (f.statistics.length)
        text(
          f.statistics.map((m) => `${m.label}: ${m.value}`).join(" | "),
          8,
          false,
          muted,
        );
    });
  }
  if (report.games?.length) {
    for (const game of report.games) {
      pdf.addPage();
      header();
      heading(`Game-by-game review: ${game.title}`);
      const summary = report.narrative.games?.find((g) => g.key === game.key);
      if (summary) text(summary.text);
      const metrics = game.groups.flatMap((group) =>
        group.metrics.map((m) => [
          `${group.title}: ${m.label}${m.value === "—" ? "" : "\n" + (m.basis ? basisText(m.basis) : report.evidence.find((e) => e.id === m.id) ? evidenceBasis(report.evidence.find((e) => e.id === m.id)!) : "Sample unavailable")}`,
          m.value === "—" ? "-" : m.value,
        ]),
      );
      const rows: string[][] = [];
      for (let i = 0; i < metrics.length; i += 2)
        rows.push([...metrics[i], ...(metrics[i + 1] ?? ["", ""])]);
      table(
        ["Measurement", "Result", "Measurement", "Result"],
        rows,
        [70, 19, 70, 19],
        true,
      );
    }
  }
  heading("Report legend");
  table(
    ["Code / measure", "Meaning"],
    reportLegend.map(([code, meaning]) => [code, meaning]),
    [44, 134],
    true,
  );
  heading("How to use this report");
  text(
    "These are observations from charted shots. Shot difficulty, ice and tactical intent can affect results. Review video and coaching observations before attributing a miss to a technical cause. Shooting percentages use the recorded scoring scale; they are not Curling Canada benchmarks.",
    8,
    false,
    muted,
  );
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
