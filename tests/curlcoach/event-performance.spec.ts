import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { sampleEvent } from "../../src/lib/curlcoach/event";
import { currentShots } from "../../src/lib/curlcoach/model";
import { difficultyIdentity } from "../../src/lib/curlcoach/difficulty";
import { shotSubtypes } from "../../src/lib/curlcoach/shot-subtypes";
import { eventPerformance } from "../../src/lib/curlcoach/event-performance";
import {
  reportInputs,
  type SavedReport,
} from "../../src/lib/curlcoach/reports";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test("season trends select types and subtypes without further database requests", async ({
  page,
}, info) => {
  let seasonReads = 0;
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    if (route.request().url().includes("seasonId=")) seasonReads++;
    const response = await route.fetch();
    const data = await response.json();
    data.catalog.forEach((entry: { startDate?: string }, i: number) => {
      entry.startDate = `2026-0${i + 1}-01`;
    });
    await route.fulfill({ response, json: data });
  });
  await page.goto("/curlcoach?event=shorty-example#analysis/performance");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  const panel = page.getByRole("region", {
    name: "Event performance over time",
    exact: true,
  });
  await expect(page.getByLabel("Event baseline comparison")).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page
    .getByRole("tab", { name: "Event Performance Over Time", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("table")).toBeVisible();
  const reads = seasonReads;
  for (const measure of [
    "type:Draw",
    "subtype:straight_draw",
    "gap",
    "difficulty",
  ]) {
    await panel
      .getByRole("combobox", { name: "Measure" })
      .selectOption(measure);
    await expect(panel.getByRole("img")).toBeVisible();
  }
  expect(seasonReads).toBe(reads);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await panel.screenshot({
    path: `test-results/event-trends-${info.project.name}.png`,
  });
});

test("reports render chronological event charts and export their PDF without AI", async ({
  page,
}, info) => {
  const events = ["2026-01-01", "2026-02-01", "2026-03-01"].map((date, i) => {
    const event = sampleEvent("shorty-example");
    event.id = `event-${i}`;
    event.name = `Synthetic event ${i + 1}`;
    event.startDate = date;
    event.games.forEach((game) => {
      game.scheduledStart = date;
      game.status = "completed";
      game.state.events.forEach((entry) => {
        if (entry.shot?.grade != null)
          entry.shot.grade = Math.max(0, entry.shot.grade - i);
      });
      const shots = currentShots(game.state.events);
      game.difficultyReady = true;
      game.analysisReady = true;
      game.difficultyRecords = shots.map((shot, n) => ({
        shotId: shot.id,
        identity: difficultyIdentity(shot),
        revision: 1,
        level: n % 5 < 4 - i ? "A" : "C",
      }));
      game.analysisRecords = shots.map((shot) => ({
        shotId: shot.id,
        identity: difficultyIdentity(shot),
        revision: 1,
        shotSubtype:
          shotSubtypes.find((s) => s.standard === shot.type)?.id ?? null,
        intendedWeight: null,
        observedDestination: null,
        resultObservations: null,
        destinationAssessment: "not_assessed",
        resultAssessment: "not_assessed",
        analysisStatus: "available",
      }));
    });
    return event;
  });
  const input = reportInputs(events[2], "team")[0];
  const saved: SavedReport = {
    ...input,
    eventPerformance: eventPerformance(events, undefined, events[2].id),
    narrative: {
      summary: {
        text: "Synthetic layout fixture. No AI request was made.",
        evidence: ["overall"],
      },
      strengths: [],
      priorities: [],
      practice: [],
      review: [],
    },
  };
  const bundled = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Report from './src/app/curlcoach/ReportDocument';import{buildReportPDF}from'./src/lib/curlcoach/report-pdf';const data=${JSON.stringify(saved)};createRoot(document.getElementById('root')).render(<><button onClick={async()=>{const pdf=await buildReportPDF(data,'Synthetic trend preview');pdf.save('synthetic-event-trends.pdf')}}>Download PDF</button><Report report={data} eventName="Synthetic trend preview"/></>);`,
    },
  });
  await page.route("**/trend-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="root"></main></body></html>',
    }),
  );
  await page.goto("/trend-fixture");
  await page.addStyleTag({
    content: readFileSync("src/app/globals.css", "utf8").replace(
      /@tailwind[^;]+;/g,
      "",
    ),
  });
  await page.addScriptTag({ content: bundled.outputFiles[0].text });
  await expect(
    page.getByRole("heading", {
      name: "Event performance over time",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "Performance across events in chronological order",
    }),
  ).toHaveCount(8);
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF" }).click();
  await (
    await download
  ).saveAs(`test-results/event-trends-report-${info.project.name}.pdf`);
  await page.screenshot({
    path: `test-results/event-trends-report-${info.project.name}.png`,
    fullPage: true,
  });
});
