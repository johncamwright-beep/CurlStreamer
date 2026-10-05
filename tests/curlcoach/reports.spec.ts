import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
let js = "";
let libraryJs = "";
let css = "";
test.beforeAll(async () => {
  execFileSync(process.execPath, [
    "node_modules/tailwindcss/lib/cli.js",
    "-i",
    "src/app/globals.css",
    "-o",
    "work/report-fixture.css",
    "--minify",
  ]);
  css = readFileSync("work/report-fixture.css", "utf8");
  const r = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Reports from './src/app/curlcoach/EventReports';createRoot(document.getElementById('root')).render(<Reports eventId="11111111-1111-4111-8111-111111111111"/>);`,
    },
  });
  js = r.outputFiles[0].text;
  const library = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import Library from './src/app/curlcoach/EventReportLibrary';createRoot(document.getElementById('root')).render(<Library/>);`,
    },
  });
  libraryJs = library.outputFiles[0].text;
});
test("event library offers generate or view without automatic generation", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/curlcoach/report-events", (route) =>
    route.fulfill({
      json: {
        events: [
          {
            id: "finished",
            name: "Finished event",
            date: "2026-10-01",
            complete: true,
            saved: 3,
            processing: false,
          },
          {
            id: "new",
            name: "New event",
            date: "2026-10-02",
            complete: true,
            saved: 0,
            processing: false,
          },
          {
            id: "future",
            name: "Future event",
            date: "2026-11-01",
            complete: false,
            saved: 0,
            processing: false,
          },
        ],
      },
    }),
  );
  await page.route("**/api/curlcoach/reports**", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({
      json: {
        configured: true,
        eligible: true,
        reason: null,
        allowance: {
          seasonStart: "2026-09-01",
          used: 1,
          limit: 20,
          reserved: false,
          owned: true,
          completed: [],
        },
        entries: [],
      },
    });
  });
  await page.route("**/library-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
        css +
        '</style></head><body><div id="root"></div><script>' +
        libraryJs +
        "</script></body></html>",
    }),
  );
  await page.goto("/library-fixture");
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "Future event" })
      .getByRole("button"),
  ).toBeDisabled();
  await page.getByRole("button", { name: "View reports", exact: true }).click();
  await expect(
    page.getByRole("navigation", { name: "Event report list" }),
  ).toBeVisible();
  expect(posts).toBe(0);
  await page.getByRole("button", { name: "← All events", exact: true }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: "New event" })
    .getByRole("button", { name: "Generate reports" })
    .click();
  await expect(
    page.getByRole("button", { name: "Generate reports", exact: true }),
  ).toBeEnabled();
  expect(posts).toBe(0);
});
test("report navigation is read-only, generation is explicit, and PDFs contain only the selected report", async ({
  page,
}, info) => {
  let posts = 0,
    used = 0,
    reserved = false,
    eligible = true,
    owned = true;
  const entries: {
    audience: string;
    status: string;
    stale: boolean;
    packet: unknown;
  }[] = [];
  const report = (key: string, title: string) => ({
    key,
    title,
    ...(key.startsWith("p")
      ? {
          games: [
            {
              key: "game-1",
              title: "Opening game",
              groups: [
                {
                  title: "Overall shooting",
                  metrics: [
                    { id: "game-1-overall", label: "Overall", value: "75.0%" },
                  ],
                },
                {
                  title: "Shot types",
                  metrics: [
                    { id: "game-1-type-0", label: "Draw", value: "80.0%" },
                    { id: "game-1-type-1", label: "Peel", value: "—" },
                  ],
                },
              ],
            },
          ],
        }
      : {}),
    limitations: ["PRIVATE COVERAGE DETAILS"],
    evidence: [
      {
        id: "overall",
        label: "Recorded shooting",
        value:
          "76.3%; 301 graded / 306 recorded; 3 ungraded; 2 excluded; 42 low grades",
        sample: 301,
        confidence: "event",
      },
      {
        id: "type-0",
        label: "Draw",
        value: "85.6%; 32 graded",
        sample: 32,
        confidence: "event",
      },
    ],
    narrative: {
      ...(key.startsWith("p")
        ? {
            games: [
              {
                key: "game-1",
                text: "Your draws provided a useful starting point. Rehearse the target on both turns.",
                evidence: ["game-1-overall"],
              },
            ],
          }
        : {}),
      summary: {
        text: "A solid event with room to sharpen draws.",
        evidence: ["overall"],
      },
      strengths: [
        {
          text: "Your draws gave you good opportunities.",
          evidence: ["type-0"],
        },
      ],
      priorities: [
        { text: "Work on finishing behind the guard.", evidence: ["overall"] },
      ],
      practice: [
        {
          text: "Place a guard and repeat the draw on both turns.",
          evidence: ["type-0"],
        },
      ],
      review: [{ text: "PRIVATE REVIEW QUESTION", evidence: ["overall"] }],
    },
  });
  await page.route("**/api/curlcoach/reports**", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      reserved = true;
      used = 1;
      const { audience } = route.request().postDataJSON();
      const packet = {
        audience,
        eventName: "Synthetic event",
        policy: "fixture",
        generatedAt: new Date().toISOString(),
        reports:
          audience === "players"
            ? [report("p1", "Alex Greenwood"), report("p2", "Cameron Wright")]
            : [
                report(
                  audience,
                  audience === "coach" ? "Coach report" : "Team report",
                ),
              ],
      };
      entries.push({ audience, status: "ready", stale: true, packet });
      await route.fulfill({ json: { packet } });
      return;
    }
    await route.fulfill({
      json: {
        configured: true,
        eligible,
        reason: eligible ? null : "Event still in progress",
        allowance: {
          seasonStart: "2026-09-01",
          used,
          limit: 20,
          reserved,
          owned,
          completed: entries.map((e) => e.audience),
        },
        entries,
      },
    });
  });
  await page.route("**/report-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
        css +
        '</style></head><body><div id="root"></div><script>' +
        js +
        "</script></body></html>",
    }),
  );
  await page.goto("/report-fixture");
  const nav = page.getByRole("navigation", { name: "Event report list" });
  await nav.getByRole("button", { name: "Team report", exact: true }).click();
  expect(posts).toBe(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  used = 20;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate reports", exact: true }),
  ).toBeDisabled();
  reserved = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate reports", exact: true }),
  ).toBeEnabled();
  owned = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate reports", exact: true }),
  ).toBeDisabled();
  owned = true;
  used = 0;
  reserved = false;
  await page.reload();
  await page
    .getByRole("button", { name: "Generate reports", exact: true })
    .click();
  await expect(
    nav.getByRole("button", { name: "Cameron Wright", exact: true }),
  ).toBeVisible();
  expect(posts).toBe(3);
  await nav
    .getByRole("button", { name: "Alex Greenwood", exact: true })
    .click();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article")).toContainText("76.3%");
  await expect(page.getByRole("article")).toContainText("85.6%");
  await expect(page.getByRole("article")).not.toContainText("301");
  await expect(page.getByRole("article")).not.toContainText("ungraded");
  await expect(page.getByRole("article")).not.toContainText("PRIVATE");
  await expect(
    page.getByRole("heading", { name: "Opening game", exact: true }),
  ).toBeVisible();
  await page.getByText("Game statistics", { exact: true }).click();
  await expect(page.getByText("80.0%", { exact: true })).toBeVisible();
  await expect(page.getByText("—", { exact: true })).toBeVisible();
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain("Alex Greenwood");
  const file = await download.path();
  const pdf = readFileSync(file!, "latin1");
  expect(pdf.startsWith("%PDF")).toBe(true);
  expect(pdf).toContain("Alex Greenwood");
  expect(pdf).not.toContain("Cameron Wright");
  expect(pdf).not.toContain("ungraded");
  expect(pdf).toContain("Opening game");
  expect(pdf).toContain("80.0%");
  await download.saveAs("test-results/report-" + info.project.name + ".pdf");
  await page.screenshot({
    path: "test-results/report-redesign-" + info.project.name + ".png",
    fullPage: true,
  });
  eligible = false;
  await page.reload();
  await nav.getByRole("button", { name: "Team report", exact: true }).click();
  await expect(page.getByRole("article")).toBeVisible();
  expect(posts).toBe(3);
});

test("Shot Tracker is available at its product-named address", async ({
  page,
}) => {
  await page.goto("/shot-tracker");
  await expect(
    page.getByRole("heading", { name: "Unlock your local session" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", {
      name: "Shot Tracker pages",
      includeHidden: true,
    }),
  ).toBeAttached();
});
