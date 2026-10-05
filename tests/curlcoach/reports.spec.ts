import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
let js = "";
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
});
test("one-touch audiences, immutable saved reports, season allowance and completion gating", async ({
  page,
}, info) => {
  let eligible = true,
    stale = false,
    posts = 0,
    used = 0,
    reserved = false,
    owned = true;
  const entries: unknown[] = [];
  const finding = {
    text: "Our team can repeat a shared target drill.",
    evidence: ["overall"],
  };
  await page.route("**/api/curlcoach/reports**", async (route) => {
    if (route.request().method() === "POST") {
      posts++;
      const body = route.request().postDataJSON();
      expect(Object.keys(body).sort()).toEqual(["audience", "eventId"]);
      const packet = {
        eventName: "Synthetic completed event",
        audience: body.audience,
        policy: "fixture",
        generatedAt: new Date().toISOString(),
        reports: [
          {
            key: body.audience,
            title: body.audience === "team" ? "Team report" : "Coach report",
            limitations: ["SYNTHETIC BROWSER FIXTURE"],
            evidence: [
              {
                id: "overall",
                label: "Recorded shooting",
                value: "75%; 40 graded",
                sample: 40,
                confidence: "event",
              },
            ],
            narrative: {
              summary: finding,
              strengths: [finding],
              priorities: [finding],
              practice: [finding],
              review: [finding],
            },
          },
        ],
      };
      entries.splice(0, entries.length, {
        audience: body.audience,
        status: "ready",
        stale: false,
        packet,
      });
      stale = false;
      await route.fulfill({ json: { packet } });
      return;
    }
    await route.fulfill({
      json: {
        configured: true,
        allowance: {
          seasonStart: "2026-09-01",
          used,
          limit: 20,
          reserved,
          owned,
          completed: [],
        },
        eligible,
        reason: eligible
          ? null
          : "Reports become available when every game is completed.",
        entries: entries.map((e) => ({ ...(e as object), stale })),
      },
    });
  });
  await page.route("**/report-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}body{padding:16px}</style></head><body><p>SYNTHETIC BROWSER FIXTURE</p><div id="root"></div><script>${js}</script></body></html>`,
    }),
  );
  await page.goto("/report-fixture");
  await expect(
    page.getByRole("button", { name: "Generate team report", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Generate team report", exact: true })
    .click();
  await expect(page.getByRole("article")).toContainText("Team report");
  await expect(
    page.getByText("All recorded evidence", { exact: true }),
  ).toHaveCount(1);
  expect(posts).toBe(1);
  await page
    .getByRole("button", { name: "Open team report", exact: true })
    .click();
  expect(posts).toBe(1);
  await expect(page.locator("textarea,input")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Generate coach report", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Generate individual reports",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: `test-results/shot-tracker-reports-${info.project.name}.png`,
    fullPage: true,
  });
  stale = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open team report", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.getByRole("button", { name: "View saved team report" }).click();
  await expect(page.getByRole("article")).toContainText("Out of date");
  expect(posts).toBe(1);
  used = 20;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate coach report", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Open team report", exact: true }),
  ).toBeEnabled();
  reserved = true;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate coach report", exact: true }),
  ).toBeEnabled();
  owned = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate coach report", exact: true }),
  ).toBeDisabled();
  owned = true;
  eligible = false;
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Generate coach report", exact: true }),
  ).toBeDisabled();
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
