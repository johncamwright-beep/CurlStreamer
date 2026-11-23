import type { jsPDF } from "jspdf";
import {
  cellText,
  matrixChange,
  matrixEndpoints,
  matrixPoints,
  matrixScope,
  type ReportMatrix,
} from "./report-matrix";

export function drawReportMatrix(
  pdf: jsPDF,
  matrix: ReportMatrix,
  start: number,
  bottom: number,
  newPage: () => number,
) {
  const left = 16,
    width = 178,
    labelWidth = 31,
    sparkWidth = 21,
    changeWidth = 19,
    totalWidth = 17;
  const sparkX = left + labelWidth,
    dataX = sparkX + sparkWidth,
    changeX = left + width - changeWidth,
    totalX = changeX - totalWidth;
  let y = start;
  const font = (size: number, bold = false, color = "#172C3E") => {
    pdf.setFont("ReportSans", bold ? "bold" : "normal");
    pdf.setFontSize(size);
    pdf.setTextColor(color);
  };
  const fill = (
    x: number,
    top: number,
    w: number,
    h: number,
    color: string,
  ) => {
    pdf.setFillColor(color);
    pdf.rect(x, top, w, h, "F");
  };
  // Wider events flow into consecutive column panels. Trends and change still span the full event.
  for (let offset = 0; offset < matrix.columns.length; offset += 6) {
    const columns = matrix.columns.slice(offset, offset + 6);
    const colWidth = (totalX - dataX) / columns.length;
    font(7);
    const names = columns.map(
      (c) => pdf.splitTextToSize(c.name, colWidth - 2) as string[],
    );
    const headHeight = 8 + Math.max(...names.map((parts) => parts.length)) * 3;
    font(10);
    const narrative =
      offset === 0 && matrix.narrative
        ? (pdf.splitTextToSize(matrix.narrative, width - 4) as string[])
        : [];
    const narrativeHeight = narrative.length ? narrative.length * 4.3 + 4 : 0;
    function header(continued: boolean) {
      font(15, true);
      fill(left, y - 4, 1.6, 5.5, "#13B8CE");
      pdf.text(matrix.title, left + 4, y);
      font(9, false, "#526574");
      const scope =
        matrixScope(matrix) +
        (matrix.columns.length > 6
          ? ` · ${columns[0].key}–${columns.at(-1)!.key}`
          : "") +
        (continued ? " · continued" : "");
      pdf.text(scope, left + width, y, { align: "right" });
      y += 3;
      if (!continued && narrative.length) {
        font(10);
        narrative.forEach((line, index) =>
          pdf.text(line, left + 2, y + 3.8 + index * 4.3),
        );
        y += narrativeHeight;
      }
      fill(left, y, width, headHeight, "#102432");
      fill(totalX, y, totalWidth, headHeight, "#205778");
      font(8, true, "#FFFFFF");
      pdf.text("Measure", left + 1.6, y + 5);
      pdf.text("Trend", sparkX + sparkWidth / 2, y + 5, { align: "center" });
      pdf.text("Change", changeX + changeWidth / 2, y + 5, { align: "center" });
      pdf.text("Total", totalX + totalWidth / 2, y + 5, { align: "center" });
      columns.forEach((c, i) =>
        pdf.text(c.key, dataX + (i + 0.5) * colWidth, y + 5, {
          align: "center",
        }),
      );
      font(7, false, "#FFFFFF");
      names.forEach((parts, i) =>
        parts.forEach((part, j) =>
          pdf.text(part, dataX + (i + 0.5) * colWidth, y + 9 + j * 3, {
            align: "center",
          }),
        ),
      );
      pdf.text(matrixEndpoints(matrix), changeX + changeWidth / 2, y + 9, {
        align: "center",
      });
      const axisY = y + headHeight - 2;
      const tick = (label: string, frac: number) =>
        pdf.text(label, sparkX + 2 + (sparkWidth - 4) * frac, axisY, {
          align: "center",
        });
      matrix.columns.forEach((c, i) => {
        if (
          matrix.columns.length <= 5 ||
          i === 0 ||
          i === matrix.columns.length - 1
        )
          tick(
            c.key,
            matrix.columns.length === 1 ? 0.5 : i / (matrix.columns.length - 1),
          );
      });
      y += headHeight;
    }
    if (
      matrix.title !== "Event Stats" ||
      offset ||
      y + narrativeHeight + headHeight + 25 > bottom
    )
      y = newPage();
    header(false);
    function groupHeading(title: string) {
      fill(left, y, width, 5.6, "#DEEBEE");
      font(7.8, true, "#173E49");
      pdf.text(title, left + 1.6, y + 3.9);
      y += 5.6;
    }
    for (const group of matrix.groups) {
      // Keep short measurement groups together, including their repeated column headings.
      if (y + 5.6 + Math.min(10, group.rows.length) * 7.8 > bottom) {
        y = newPage();
        header(true);
      }
      groupHeading(group.title);
      for (const [rowIndex, row] of group.rows.entries()) {
        font(7.5);
        const label = pdf.splitTextToSize(
          row.label,
          labelWidth - 2.8,
        ) as string[];
        const height = Math.max(7.8, 2 + label.length * 3.1);
        if (y + height > bottom) {
          y = newPage();
          header(true);
          groupHeading(group.title);
        }
        fill(
          left,
          y,
          width,
          height,
          rowIndex % 2 === 0 ? "#F1F6F7" : "#FFFFFF",
        );
        font(7.5);
        label.forEach((part, j) =>
          pdf.text(
            part,
            left + 1.6,
            y + (height - label.length * 3.1) / 2 + 2.6 + j * 3.1,
          ),
        );
        const points = matrixPoints(row).map(
          (p) =>
            p && {
              x: sparkX + 2 + p.x * (sparkWidth - 4),
              y: y + 1.4 + p.y * (height - 2.8),
            },
        );
        pdf.setDrawColor("#087D83");
        pdf.setFillColor("#FFFFFF");
        pdf.setLineWidth(0.38);
        points.forEach((p, i) => {
          if (!p) return;
          const prev = points[i - 1];
          if (prev) pdf.line(prev.x, prev.y, p.x, p.y);
        });
        points.forEach((p) => {
          if (p) pdf.circle(p.x, p.y, 0.65, "FD");
        });
        [
          ...row.cells.slice(offset, offset + columns.length),
          row.total,
        ].forEach((c, i) => {
          const total = i === columns.length;
          const x = total
            ? totalX + totalWidth / 2
            : dataX + (i + 0.5) * colWidth;
          if (total) fill(totalX, y, totalWidth, height, "#DCEFF9");
          font(8, total);
          pdf.text(cellText(c), x, y + (c.sample ? 3.3 : height / 2 + 1), {
            align: "center",
          });
          if (c.sample) {
            font(6.6, false, "#465B69");
            pdf.text("(" + c.sample + ")", x, y + 6.4, { align: "center" });
          }
        });
        const delta = matrixChange(row);
        font(7.8, true, delta.color);
        pdf.text(delta.text, changeX + changeWidth / 2, y + height / 2 + 1, {
          align: "center",
        });
        y += height;
      }
    }
  }
  return y + 5;
}
