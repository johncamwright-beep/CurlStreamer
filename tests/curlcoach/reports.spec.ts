import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { technicalSummary } from "../../src/lib/curlcoach/technical";
import { gameShots, sampleEvent } from "../../src/lib/curlcoach/event";
import { reportAnalysis } from "../../src/lib/curlcoach/report-analysis";
import {
  difficultyBenchmarks,
  difficultySummary,
} from "../../src/lib/curlcoach/difficulty";
import type {
  ReportPacket,
  SavedReport,
} from "../../src/lib/curlcoach/reports";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
let js = "";
let libraryJs = "";
let workspaceJs = "";
let css = "";

test("player generation continues automatically, exposes a partial failure and retries remaining work", async ({
  page,
}) => {
  let statusReads = 0;
  let generationStarted = false;
  let releaseGeneration!: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGeneration = resolve;
  });
  await page.clock.install();
  const entries = new Map<string, object>();
  let playerRequests = 0;
  const summary = {
    text: "Draw weight settled later in the event.",
    evidence: ["overall"],
  };
  const saved = (key: string, title: string) => ({
    key,
    title,
    evidence: [
      {
        id: "overall",
        label: "Shooting",
        value: "75.0%",
        sample: 20,
        confidence: "event",
      },
    ],
    limitations: [],
    highlights: {
      strengths: [],
      priorities: [],
      withinGames: [],
      acrossGames: [],
    },
    narrative: {
      summary,
      strengths: [],
      priorities: [],
      practice: [summary],
      review: [],
    },
  });
  const players = [
    { key: "player-1", name: "Alex" },
    { key: "player-2", name: "Blair" },
  ];
  const first = saved("player-1", "Alex");
  await page.route("**/api/curlcoach/reports**", async (route) => {
    if (route.request().method() === "POST") {
      const { audience } = route.request().postDataJSON();
      if (audience === "coach") {
        generationStarted = true;
        await gate;
      }
      if (audience === "players") playerRequests++;
      const partial = audience === "players" && playerRequests < 3;
      const packet = {
        audience,
        eventName: "Test event",
        policy: "shot-tracker-event-v9",
        generatedAt: new Date().toISOString(),
        complete: !partial,
        reports:
          audience === "players"
            ? partial
              ? [first]
              : [first, saved("player-2", "Blair")]
            : [saved(audience, audience)],
      };
      const failed = audience === "players" && playerRequests === 2;
      entries.set(audience, {
        audience,
        status: failed ? "failed" : partial ? "processing" : "ready",
        resumable: partial && !failed,
        readyKeys: partial ? ["player-1"] : [],
        stale: false,
        packet,
      });
      await route.fulfill(
        failed
          ? {
              status: 503,
              json: { error: "Provider timeout. Completed reports are saved." },
            }
          : { json: { packet } },
      );
      return;
    }
    statusReads++;
    await route.fulfill({
      json: {
        configured: true,
        eligible: true,
        reason: null,
        players,
        allowance: {
          used: 1,
          limit: 20,
          reserved: true,
          owned: true,
          completed: ["coach", "team"].filter((a) => entries.has(a)),
        },
        entries: [...entries.values()],
      },
    });
  });
  await page.route("**/progress-fixture", (route) =>
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
  await page.goto("/progress-fixture");
  await page
    .getByRole("button", { name: "Generate reports", exact: true })
    .click();
  await expect.poll(() => generationStarted).toBe(true);
  await page.clock.fastForward(20000);
  expect(statusReads).toBe(1);
  releaseGeneration();
  await expect(page.getByText("Alex: Ready", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Blair: Failed - retry available", { exact: true }),
  ).toBeVisible();
  expect(playerRequests).toBe(2);
  await page
    .getByRole("button", { name: "Generate remaining reports", exact: true })
    .click();
  await expect(page.getByText("Blair: Ready", { exact: true })).toBeVisible();
  expect(playerRequests).toBe(3);
  await page.screenshot({
    path: "work/trend-progress-phone.png",
    fullPage: true,
  });
  await expect(
    page.getByRole("button", {
      name: "Generate remaining reports",
      exact: true,
    }),
  ).toHaveCount(0);
});

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
  const workspace = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{EventWorkspace}from './src/components/EventWorkspace';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-5"><h1 className="mb-5 text-3xl font-bold">Shorty Jenkins Classic</h1><EventWorkspace eventId="fixture" reportsEnabled edit={<label>Event name<input defaultValue="Shorty Jenkins Classic"/></label>} schedule={<h2>Scheduled games</h2>}/></main>);`,
    },
  });
  workspaceJs = workspace.outputFiles[0].text;
});
test("event library views saved reports without generation and starts a new set with one click", async ({
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
  await expect.poll(() => posts).toBe(3);
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
    packet: ReportPacket;
  }[] = [];
  const exampleShot = gameShots(sampleEvent("shorty-example").games[0])[0];
  const legacyDifficulty = difficultySummary(
    [
      { ...exampleShot, grade: 4, difficulty: "C", excluded: null },
      { ...exampleShot, grade: 5, excluded: null },
    ],
    { ...difficultyBenchmarks, version: "illustrative-v1", baseline: 70 },
  );
  const report = (key: string, title: string): SavedReport => ({
    key,
    title,
    ...(key.startsWith("p")
      ? {
          difficulty: legacyDifficulty,
          technical: technicalSummary([
            {
              playerId: "fixture",
              position: "Lead",
              end: 1,
              stone: 1,
              type: "Draw",
              turn: null,
              grade: 4,
              execution: "Partial",
              deficiency: "Undercurl",
              line: "Wide",
              release: "Soft",
              technical: "Understep",
              review: null,
              excluded: null,
              note: "",
            },
          ]),
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
    advanced: {
      included: 4,
      recorded: 3,
      unavailable: 0,
      needsReview: 0,
      groups: [
        {
          title: "Called and observed weight",
          metrics: [
            {
              id: "advanced-weight-1_guard-2_guard",
              label: "Called Guard 1; observed Guard 2",
              value: "50.0% (2 of 4 shots)",
              sample: 4,
              confidence: "small",
            },
          ],
        },
      ],
    },
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
      {
        id: "difficulty",
        label: "Difficulty context",
        value:
          "Difficulty adjusted: 95.0% · Above expected: +25.0 pp. Coverage: 1 of 2 eligible graded shots (50.0%). Classified subset actual 80.0%, expected 55.0%; reference baseline 70.0%.",
        sample: 1,
        confidence: "small",
      },
    ],
    narrative: {
      ...(key.startsWith("p")
        ? {
            games: [
              {
                key: "game-1",
                text: "Game １: Your draws provided a useful starting point. Rehearse the target on both turns.",
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
        {
          text: "Work on finishing behind the guard.",
          evidence: ["difficulty", "overall"],
        },
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
      const packet: ReportPacket = {
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
  await expect(page.getByRole("article")).toContainText("301 graded shots");
  const summary = page.getByLabel("Report summary", { exact: true });
  await expect(summary).toContainText("Easy-shot equivalent index");
  await expect(summary.getByText("110.0", { exact: true })).toBeVisible();
  await expect(summary).toContainText("1 of 2 graded shots with difficulty");
  await expect(page.getByRole("article")).not.toContainText(
    "Difficulty adjusted: 95.0%",
  );
  await expect(
    page.getByRole("heading", { name: "Report legend", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("article")).not.toContainText("PRIVATE");
  await expect(
    page.getByRole("heading", {
      name: "Game-by-game review: Opening game",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("80.0%", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row", { name: "Shot types: Peel -" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "80.0%", exact: true }),
  ).toHaveCSS("color", "rgb(23, 44, 62)");
  await expect(
    page.getByText("Called Guard 1; observed Guard 2", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("50.0% (2 of 4 shots)", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toContain("Alex Greenwood");
  const file = await download.path();
  const pdf = readFileSync(file!, "latin1");
  expect(pdf.startsWith("%PDF")).toBe(true);
  expect(pdf).toContain("Alex Greenwood");
  expect(pdf).not.toContain("Cameron Wright");
  expect(pdf).toContain("/FontFile2");
  expect(pdf).not.toContain("/BaseFont /Helvetica");
  expect(pdf.length).toBeLessThan(500000);
  await download.saveAs("test-results/report-" + info.project.name + ".pdf");
  const charted = sampleEvent("shorty-example");
  charted.games = charted.games.slice(0, 3);
  const player = entries.find((entry) => entry.audience === "players")!.packet
    .reports[0];
  player.analysis = reportAnalysis(charted, "lead");
  const flagUrl = "https://www.youtube.com/watch?v=abcdefghijk&t=132s";
  player.flags = [
    {
      gameId: "game-1",
      shotId: "flag-1",
      game: "Opening game",
      end: 2,
      stone: 1,
      type: "Draw",
      note: "Watch the release before changing the line call.",
      url: flagUrl,
      estimated: false,
    },
  ];
  await page.reload();
  await nav
    .getByRole("button", { name: "Alex Greenwood", exact: true })
    .click();
  const article = page.getByRole("article", { name: "Alex Greenwood" });
  for (const name of [
    "Performance overview",
    "Performance over time",
    "Performance by shot",
    "Performance by turn",
    "Miss diagnosis",
    "Technical review",
    "Your flagged shots",
  ]) {
    await expect(
      article.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
  }
  await expect(
    article.getByRole("img", { name: /^Shooting percentage by game/ }),
  ).toBeVisible();
  await expect(article.getByText(player.flags[0].note)).toBeVisible();
  await expect(
    article.getByRole("link", { name: "Review video" }),
  ).toHaveAttribute("href", flagUrl);
  const appendixDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const appendix = await appendixDownload;
  expect(readFileSync((await appendix.path())!, "latin1")).toContain(flagUrl);
  await appendix.saveAs(
    "test-results/report-analysis-" + info.project.name + ".pdf",
  );
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
  for (const size of [
    { width: 390, height: 844 },
    { width: 1880, height: 1000 },
  ]) {
    await page.setViewportSize(size);
    const menu = await page.locator(".event-sidebar").boundingBox();
    expect(menu!.height).toBeLessThan(100);
  }
});

test("event sections preserve drafts and never generate on navigation", async ({
  page,
}, testInfo) => {
  let posts = 0;
  await page.route("**/api/curlcoach/reports**", (route) => {
    if (route.request().method() === "POST") posts++;
    return route.fulfill({
      json: {
        configured: true,
        eligible: true,
        allowance: {
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
  await page.route("**/workspace-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>' +
        css +
        '</style></head><body><div id="root"></div><script>' +
        workspaceJs +
        "</script></body></html>",
    }),
  );
  await page.goto("/workspace-fixture");
  await expect(
    page.getByRole("button", { name: "Generate reports", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Event name", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await page
    .getByLabel("Event name", { exact: true })
    .fill("Unsaved event draft");
  await expect(
    page.getByRole("button", { name: "Coach report", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Schedule games", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scheduled games" }),
  ).toBeVisible();
  await expect(page.getByLabel("Event name", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Edit event", exact: true }).click();
  await expect(page.getByLabel("Event name", { exact: true })).toHaveValue(
    "Unsaved event draft",
  );
  await page
    .getByRole("button", { name: "Event reports", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Individual reports", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Individual reports", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Scheduled games" }),
  ).toBeHidden();
  expect(posts).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "work/event-navigation-" + testInfo.project.name + ".png",
    fullPage: true,
  });
});

test("report email requires recipient review and explicit send; coach reports have no send control", async ({
  page,
}, testInfo) => {
  const event = (await import("../../src/lib/curlcoach/event")).sampleEvent(
    "shorty-example",
  );
  const input = (await import("../../src/lib/curlcoach/reports")).reportInputs(
    event,
    "team",
  )[0];
  const f = {
    text: "Use the recorded miss pattern to choose a focused practice.",
    evidence: ["miss-Light"],
  };
  const saved = {
    ...input,
    analysis: reportAnalysis(event),
    flags: [
      {
        gameId: "fixture-game",
        shotId: "team-flag",
        game: "Opening game",
        shooter: "Alex",
        end: 1,
        stone: 1,
        type: "Draw",
        note: "Team practice review",
        url: "https://www.youtube.com/watch?v=abcdefghijk&t=90s",
        estimated: false,
      },
    ],
    narrative: {
      summary: f,
      strengths: [f],
      priorities: [f],
      practice: [f],
      review: [],
    },
  };
  let sends = 0;
  await page.route("**/api/curlcoach/reports**", (route) =>
    route.fulfill({
      json: {
        configured: true,
        eligible: true,
        reason: null,
        allowance: {
          seasonStart: "2026-07-01",
          used: 1,
          limit: 20,
          reserved: true,
          owned: true,
          completed: ["team"],
        },
        entries: [
          {
            audience: "team",
            status: "ready",
            stale: false,
            packet: {
              audience: "team",
              eventName: "Synthetic event",
              policy: "fixture",
              generatedAt: "2026-10-01",
              reports: [saved],
            },
          },
        ],
      },
    }),
  );
  await page.route("**/api/curlcoach/report-email**", async (route) => {
    if (route.request().method() === "POST") {
      sends++;
      expect(route.request().postDataJSON()).toEqual({
        eventId: "11111111-1111-4111-8111-111111111111",
        audience: "team",
        reportKey: "team",
        planToken: "a".repeat(64),
        resend: false,
        coachName: "John Wright",
        subject: "Practice follow-up",
        coachMessage: "Please review your misses before Thursday.",
        cc: ["parent@example.test", "coach@example.test"],
      });
      return route.fulfill({
        json: {
          results: [
            { name: "Alex", email: "alex@example.test", status: "accepted" },
          ],
        },
      });
    }
    return route.fulfill({
      json: {
        planToken: "a".repeat(64),
        title: "Team report",
        coachName: "John Wright",
        subject: "Synthetic event - Team report",
        coachMessage: "Hi team, your report is attached.",
        configured: true,
        recipients: [
          {
            playerId: "alex",
            name: "Alex",
            email: "alex@example.test",
            kind: "to",
          },
          {
            playerId: "sender:coach",
            name: "You (coach copy)",
            email: "john@example.test",
            kind: "cc",
          },
        ],
        skipped: ["Sam"],
      },
    });
  });
  await page.route("**/email-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
    }),
  );
  await page.goto("/email-fixture");
  await expect(
    page.getByRole("button", { name: "Email team report", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Team report", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Miss diagnosis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Team flagged shots", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Alex · Opening game · End 1 · Stone 1",
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Email team report", exact: true })
    .click();
  await expect(page.getByText("To: Alex — alex@example.test")).toBeVisible();
  await expect(
    page.getByText("CC: You (coach copy) — john@example.test"),
  ).toBeVisible();
  await expect(
    page.getByText("can see the To and CC addresses", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("No email saved for: Sam.", { exact: false }),
  ).toBeVisible();
  expect(sends).toBe(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(sends).toBe(0);
  await page
    .getByRole("button", { name: "Email team report", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Email team report" }),
  ).toBeVisible();
  await page.getByLabel("Subject", { exact: true }).fill("Practice follow-up");
  await page
    .getByRole("textbox", { name: "Coach’s message", exact: true })
    .fill("Please review your misses before Thursday.");
  await page
    .getByLabel("CC email addresses (optional)")
    .fill("parent@example.test, coach@example.test");
  await expect(
    page.getByText("Sender: Coach John Wright", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm and send" }).click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Accepted by the email provider" }),
  ).toBeVisible();
  expect(sends).toBe(1);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("report-email-preview.png"),
    fullPage: true,
  });
});
