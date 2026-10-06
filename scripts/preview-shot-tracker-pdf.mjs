// Synthetic design preview only; does not read private data or call AI/email providers.
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
await mkdir("work/report-design", { recursive: true });
await build({
  stdin: {
    contents: `
import { writeFile, mkdir } from "node:fs/promises";
import { sampleEvent } from "./src/lib/curlcoach/event";
import { reportInputs } from "./src/lib/curlcoach/reports";
import { buildReportPDF } from "./src/lib/curlcoach/report-pdf";
const event = sampleEvent("shorty-example");
const input = reportInputs(event, "players")[0];
const finding = text => ({ text, evidence: ["overall"] });
const report = { ...input, title: "Sample player report", narrative: {
summary: finding("Your execution was more reliable on straightforward shots than on the precision shots. Use the miss breakdown below to choose a focused practice priority. These are synthetic demonstration results, not a real athlete's performance."),
strengths: [finding("Build on the shots that repeatedly reached the intended outcome. Keep a short set of those shots in each practice while spending more time on the patterns that cost execution.")],
priorities: [finding("Check the shot-type miss rates alongside the direction tags. A high share of a tag does not establish its technical cause. Separate the intended weight, initial line and final result during review.")],
practice: [], review: [], games: input.games.map(g => ({key:g.key, ...finding("Compare execution and miss direction for this game with the event pattern. Keep small differences in perspective and review the affected shot types before deciding whether to change a routine.")}))
} };
await mkdir("output/pdf", {recursive:true});
const pdf = await buildReportPDF(report, "Design preview - synthetic seven-game event");
await writeFile("output/pdf/shot-tracker-report-design.pdf", Buffer.from(pdf.output("arraybuffer")));
console.log("PDF pages:", pdf.getNumberOfPages());
`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "work/report-design/preview.mjs",
});
await import(pathToFileURL(resolve("work/report-design/preview.mjs")).href);
