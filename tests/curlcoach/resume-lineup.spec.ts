import { build } from "esbuild";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  append,
  emptyState,
  setLineup,
  type State,
} from "../../src/lib/curlcoach/model";
import type { CoachGame, Workspace } from "../../src/lib/curlcoach/event";

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
const organizationId = "resume-fixture-organization";
const eventOne = "11111111-1111-4111-8111-111111111111";
const eventTwo = "22222222-2222-4222-8222-222222222222";
const gameOne = "33333333-3333-4333-8333-333333333333";
const gameTwo = "44444444-4444-4444-8444-444444444444";
const gameThree = "55555555-5555-4555-8555-555555555555";
const players = [
  { id: "alice", name: "Alice" },
  { id: "bob", name: "Bob" },
  { id: "chris", name: "Chris" },
];
const assignment = [
  "alice",
  "alice",
  "alice",
  "bob",
  "bob",
  "bob",
  "chris",
  "chris",
];
let javascript = "";
const stylesheet = readFileSync("src/app/curlcoach/coach.css", "utf8");

// Mount the real workspace with an authenticated actor scope. The lab server
// intentionally lacks that scope, so these visibly labelled browser fixtures
// exercise private reload behavior without weakening production access checks.
test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    loader: { ".css": "empty" },
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import EventWorkspace from "./src/app/curlcoach/EventWorkspace";
        const actorId = new URLSearchParams(location.search).get("actor") || "coach-one";
        createRoot(document.getElementById("root")).render(
          <EventWorkspace mode="streamer" unlocked accountScope={{ actorId, organizationId: "${organizationId}" }} />
        );
      `,
    },
  });
  javascript = bundle.outputFiles[0].text;
});

async function fixture(
  page: Page,
  options: {
    loseFirstLineupResponse?: boolean;
    lineupRequests?: string[];
  } = {},
) {
  const games = new Map<string, CoachGame>();
  const lineupReplies = new Map<string, State>();
  for (const [id, eventId, label] of [
    [gameOne, eventOne, "Game one"],
    [gameTwo, eventOne, "Game two"],
    [gameThree, eventTwo, "Game three"],
  ]) {
    const state: State = {
      ...emptyState(),
      organizationId,
      gameId: id,
      roster: players,
    };
    games.set(id, {
      id,
      eventId,
      label,
      opponent: "Fixture opponent",
      teamName: "Fixture team",
      scheduledEnds: 8,
      status: "active",
      side: "home",
      initialHammer: "home",
      ends: [],
      scoreboardAvailable: false,
      roster: players,
      state,
    });
  }
  await page.route("**/__tracker_bundle.js", (route) =>
    route.fulfill({ contentType: "application/javascript", body: javascript }),
  );
  await page.route("**/__tracker_fixture**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${stylesheet}dialog{max-height:90vh;overflow:auto}dialog label{display:block}</style><p>BROWSER TEST FIXTURE · mocked authorized API</p><div id="root"></div><script src="/__tracker_bundle.js"></script>`,
    }),
  );
  await page.route("**/api/account/navigation", (route) =>
    route.fulfill({ json: { platformAdmin: false } }),
  );
  await page.route("**/api/curlcoach/workspace**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      const body = request.postDataJSON();
      const game = games.get(body.gameId)!;
      if (body.action === "set-lineup") {
        options.lineupRequests?.push(body.requestId);
        const previous = lineupReplies.get(body.requestId);
        if (previous) {
          await route.fulfill({ json: previous });
          return;
        }
      }
      if (
        (body.command?.expectedRevision ?? body.expectedRevision) !==
        game.state.revision
      ) {
        await route.fulfill({
          status: 409,
          json: { error: "Fixture revision conflict" },
        });
        return;
      }
      game.state =
        body.action === "set-lineup"
          ? setLineup(
              game.state,
              {
                action: "set-lineup",
                lineup: body.lineup,
                requestId: body.requestId,
                expectedRevision: body.expectedRevision,
              },
              "fixture-coach",
            )
          : body.action === "reopen" || body.action === "finish"
            ? {
                ...game.state,
                status: body.action === "reopen" ? "open" : "closed",
                reopened: body.action === "reopen",
                revision: game.state.revision! + 1,
              }
            : append(game.state, body.command, "fixture-coach");
      if (body.action === "set-lineup") {
        lineupReplies.set(body.requestId, game.state);
        if (options.loseFirstLineupResponse && lineupReplies.size === 1) {
          await route.abort("failed");
          return;
        }
      }
      await route.fulfill({ json: game.state });
      return;
    }
    const query = new URL(request.url()).searchParams;
    const eventId = query.get("eventId") || eventOne;
    const season = query.has("seasonId");
    const workspace: Workspace = {
      event: {
        id: season ? "season-fixture" : eventId,
        name: eventId === eventOne ? "Event one" : "Event two",
        source: "streamer",
        organizationId,
        seasonId: "season-fixture",
        games: [...games.values()].filter(
          (game) => season || game.eventId === eventId,
        ),
      },
      catalog: [
        { id: eventOne, name: "Event one", seasonId: "season-fixture" },
        { id: eventTwo, name: "Event two", seasonId: "season-fixture" },
      ],
      seasons: [{ id: "season-fixture", name: "Fixture season" }],
      refreshedAt: new Date().toISOString(),
    };
    await route.fulfill({ json: workspace });
  });
  await page.goto(
    `/__tracker_fixture?event=${eventOne}&game=${gameOne}#scoring`,
  );
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameOne);
  return games;
}

async function start(page: Page) {
  await page
    .getByRole("button", { name: "Start Charting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Confirm lineup & start", exact: true })
    .click();
  await expect(page.getByLabel("Numeric grade")).toBeVisible();
}
test("new games require lineup confirmation and keep actions inside the selected game", async ({
  page,
}, info) => {
  await fixture(page);
  await expect(page.getByLabel("Numeric grade")).toBeHidden();
  await expect(page.locator(".coach-topbar").getByRole("button")).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "Start Charting" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Numeric grade")).toBeHidden();
  await start(page);
  await expect(
    page
      .getByRole("group", { name: "Game actions" })
      .getByRole("button", { name: "Edit lineup" }),
  ).toBeVisible();
  await page.getByLabel("End", { exact: true }).fill("3");
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption(gameTwo);
  await expect(
    page.getByRole("button", { name: "Start Charting" }),
  ).toBeVisible();
  await expect(page.getByLabel("Numeric grade")).toBeHidden();
  await start(page);
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption(gameOne);
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("3");
  await page.screenshot({
    path: "work/charting-flow-" + info.project.name + ".png",
    fullPage: true,
  });
});
test("completed games show only their closed panel until explicitly reopened", async ({
  page,
}) => {
  const games = await fixture(page);
  await start(page);
  games.get(gameOne)!.status = "completed";
  await page.getByRole("button", { name: "Refresh event" }).click();
  await expect(
    page.getByRole("heading", { name: "Game closed", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Numeric grade")).toBeHidden();
  await expect(page.getByRole("button", { name: "Edit lineup" })).toBeHidden();
  await page.getByRole("button", { name: "Reopen", exact: true }).click();
  await expect(page.getByLabel("Numeric grade")).toBeVisible();
  expect(games.get(gameOne)!.status).toBe("completed");
  await page.reload();
  await expect(page.getByLabel("Numeric grade")).toBeVisible();
  await page
    .getByRole("button", { name: "Finish private coaching session" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Game closed", exact: true }),
  ).toBeVisible();
});
test("event transitions retain the event picker without flashing an unavailable error", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption(eventTwo);
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveValue(eventTwo);
  await expect(
    page.getByRole("heading", { name: "Event data is unavailable" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Start Charting" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameThree);
});
test("lost lineup response retries the original request and retains the three-player lineup", async ({
  page,
}) => {
  const requests: string[] = [];
  const games = await fixture(page, {
    loseFirstLineupResponse: true,
    lineupRequests: requests,
  });
  await page.getByRole("button", { name: "Start Charting" }).click();
  for (let i = 0; i < 8; i++)
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Rock " + (i + 1), exact: true })
      .selectOption(assignment[i]);
  await page.getByRole("button", { name: "Confirm lineup & start" }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toBeVisible();
  await page.getByRole("button", { name: "Confirm lineup & start" }).click();
  await expect(page.getByLabel("Numeric grade")).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0]).toBe(requests[1]);
  expect(games.get(gameOne)!.state.lineup).toEqual(assignment);
  expect(games.get(gameOne)!.state.lineupEvents).toHaveLength(1);
});
test("reload preserves drafts and lineup changes never rewrite recorded players", async ({
  page,
}) => {
  const games = await fixture(page);
  await start(page);
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page.getByLabel("Numeric grade").selectOption("4");
  await page.getByRole("button", { name: /^Next turn/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await page.getByLabel("Private coaching note").fill("Next rock note");
  await page.reload();
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Next rock note",
  );
  await page.getByRole("button", { name: "Edit lineup" }).click();
  await page
    .getByRole("dialog")
    .getByRole("combobox", { name: "Rock 1", exact: true })
    .selectOption("chris");
  await page.getByRole("button", { name: "Save lineup", exact: true }).click();
  expect(games.get(gameOne)!.state.events[0].shot!.playerId).toBe("alice");
  await page.getByRole("button", { name: "Undo latest change" }).click();
  await expect.poll(() => games.get(gameOne)!.state.events.length).toBe(2);
});
