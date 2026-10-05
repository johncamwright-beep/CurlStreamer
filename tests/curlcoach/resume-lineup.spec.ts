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

async function stats(page: Page) {
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name: "Shot breakdown", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Shot breakdown", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Resume tracking", exact: true }),
  ).toBeVisible();
}
async function next(page: Page) {
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page.getByLabel("Numeric grade").selectOption("4");
  await page.getByRole("button", { name: /^Next turn/ }).click();
  await expect(page.getByLabel("Numeric grade")).toHaveValue("");
}

test("Resume returns an unsaved tracking draft after statistics filters and game/event browsing", async ({
  page,
}) => {
  await fixture(page);
  await page.getByLabel("End", { exact: true }).fill("3");
  await page
    .getByLabel("Private coaching note")
    .fill("Continue this unsaved turn");
  await stats(page);
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption(eventTwo);
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption(gameThree);
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameOne);
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Continue this unsaved turn",
  );
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption(gameTwo);
  await page
    .getByRole("combobox", { name: "Event", exact: true })
    .selectOption(eventTwo);
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameThree);
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Event", exact: true }),
  ).toHaveValue(eventOne);
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameOne);
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Continue this unsaved turn",
  );
});

test("historical review and correction preserve the parked tracking turn", async ({
  page,
}) => {
  await fixture(page);
  await next(page);
  await page.getByLabel("Private coaching note").fill("Current second rock");
  await page
    .locator(".coach-attempt")
    .first()
    .getByRole("button", { name: "Correct", exact: true })
    .click();
  await page.getByLabel("Private coaching note").fill("Historical correction");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(page.locator(".coach-attempt").first()).toContainText(
    "Historical correction",
  );
  await stats(page);
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Current second rock",
  );
  await expect(
    page.getByRole("button", { name: "Save attempt", exact: true }),
  ).toBeVisible();
});

test("saved three-player lineup charts eight rocks in 3/3/2 order and survives reload", async ({
  page,
}, testInfo) => {
  const games = await fixture(page);
  if (testInfo.project.name === "phone")
    await page.screenshot({ path: "work/tracker-scoring-phone.png" });
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Set game lineup" });
  if (testInfo.project.name === "phone")
    await page.screenshot({ path: "work/tracker-lineup-phone.png" });
  for (let i = 0; i < 8; i++)
    await expect(
      dialog.getByRole("combobox", { name: `Rock ${i + 1}`, exact: true }),
    ).toHaveValue(assignment[i]);
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(games.get(gameOne)?.state.lineup).toEqual(assignment);
  for (let rock = 1; rock <= 8; rock++) {
    await expect(page.locator(".coach-scoring")).toContainText(
      `End 1 · Rock ${rock} of 8`,
    );
    await expect(
      page.getByRole("combobox", { name: "Player", exact: true }),
    ).toHaveValue(assignment[rock - 1]);
    await next(page);
  }
  await expect(page.locator(".coach-scoring")).toContainText(
    "End 2 · Rock 1 of 8",
  );
  expect(
    games.get(gameOne)?.state.events.map((event) => event.shot?.playerId),
  ).toEqual(assignment);
  await page.reload();
  await expect(page.locator(".coach-scoring")).toContainText(
    "End 2 · Rock 1 of 8",
  );
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  for (let i = 0; i < 8; i++)
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: `Rock ${i + 1}`, exact: true }),
    ).toHaveValue(assignment[i]);
});

test("private reload restores unsaved progress, honors explicit game and isolates another actor", async ({
  page,
}) => {
  await fixture(page);
  await next(page);
  await page.getByLabel("Private coaching note").fill("Private continuation");
  await stats(page);
  await page.reload();
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Private continuation",
  );
  await page.goto(
    `/__tracker_fixture?event=${eventOne}&game=${gameTwo}#scoring`,
  );
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameTwo);
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toHaveValue(gameOne);
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Private continuation",
  );
  await page.goto(
    `/__tracker_fixture?actor=coach-two&event=${eventOne}&game=${gameOne}#scoring`,
  );
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(page.getByLabel("Private coaching note")).toHaveValue("");
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(page.getByLabel("Private coaching note")).toHaveValue("");
});

test("retrying a lost lineup response reuses its request identity", async ({
  page,
}) => {
  const lineupRequests: string[] = [];
  const games = await fixture(page, {
    loseFirstLineupResponse: true,
    lineupRequests,
  });
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Set game lineup" });
  await dialog
    .getByRole("combobox", { name: "Rock 1", exact: true })
    .selectOption("bob");
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(lineupRequests).toHaveLength(2);
  expect(lineupRequests[1]).toBe(lineupRequests[0]);
  expect(games.get(gameOne)?.state.revision).toBe(1);
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("bob");
});

test("lineup changes during correction update the parked turn and preserve the recorded player", async ({
  page,
}) => {
  await fixture(page);
  await next(page);
  await page.getByLabel("Private coaching note").fill("Parked second rock");
  await page
    .locator(".coach-attempt")
    .first()
    .getByRole("button", { name: "Correct", exact: true })
    .click();
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Set game lineup" });
  await dialog
    .getByRole("combobox", { name: "Rock 1", exact: true })
    .selectOption("bob");
  await dialog
    .getByRole("combobox", { name: "Rock 2", exact: true })
    .selectOption("chris");
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("alice");
  await expect(
    page.getByRole("button", { name: "Save correction", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("chris");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Parked second rock",
  );
  await expect(page.locator(".coach-attempt").first()).toContainText("Alice");
});

test("an old idempotent lineup retry cannot roll back a newer authoritative lineup or shot", async ({
  page,
}) => {
  const lineupRequests: string[] = [];
  const games = await fixture(page, {
    loseFirstLineupResponse: true,
    lineupRequests,
  });
  const oldLineup = [...assignment];
  oldLineup[0] = "bob";
  await page
    .getByLabel("Private coaching note")
    .fill("Initial tracking anchor");
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "Set game lineup" });
  await dialog
    .getByRole("combobox", { name: "Rock 1", exact: true })
    .selectOption("bob");
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();

  // Another session of this same actor confirms later changes while the first
  // tab still holds its failed request. The fixture caches its OLD response.
  const game = games.get(gameOne)!;
  const newerLineup = [...assignment];
  newerLineup[0] = "chris";
  newerLineup[1] = "chris";
  game.state = setLineup(
    game.state,
    {
      action: "set-lineup",
      lineup: newerLineup,
      requestId: "66666666-6666-4666-8666-666666666666",
      expectedRevision: 1,
    },
    "fixture-coach",
  );
  game.state = append(
    game.state,
    {
      requestId: "77777777-7777-4777-8777-777777777777",
      expectedRevision: 2,
      shotId: "88888888-8888-4888-8888-888888888888",
      shot: {
        playerId: "chris",
        position: "Lead",
        stone: 1,
        end: 1,
        type: "Draw",
        turn: null,
        execution: null,
        grade: 5,
        deficiency: null,
        excluded: null,
        review: null,
        note: "Later confirmed shot",
      },
    },
    "fixture-coach",
  );
  await page
    .getByRole("button", { name: "Refresh event", exact: true })
    .click();
  await expect(page.locator(".coach-attempt")).toContainText(
    "Later confirmed shot",
  );
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("chris");
  await page
    .getByLabel("Private coaching note")
    .fill("Current authoritative turn");

  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "Set game lineup" });
  for (let i = 0; i < 8; i++)
    await dialog
      .getByRole("combobox", { name: `Rock ${i + 1}`, exact: true })
      .selectOption(oldLineup[i]);
  await dialog
    .getByRole("button", { name: "Save lineup", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(lineupRequests).toHaveLength(2);
  expect(lineupRequests[1]).toBe(lineupRequests[0]);
  await expect(page.locator(".coach-attempt")).toContainText(
    "Later confirmed shot",
  );
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("chris");
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Current authoritative turn",
  );
  await page.getByRole("button", { name: "Set lineup", exact: true }).click();
  for (let i = 0; i < 8; i++)
    await expect(
      page
        .getByRole("dialog")
        .getByRole("combobox", { name: `Rock ${i + 1}`, exact: true }),
    ).toHaveValue(newerLineup[i]);
  expect(game.state.revision).toBe(3);
});

test("opening scoring selects the approaching game and earlier games stay review-only", async ({
  page,
}) => {
  const games = await fixture(page);
  const now = Date.now();
  games.get(gameOne)!.scheduledStart = new Date(
    now - 6 * 3600000,
  ).toISOString();
  games.get(gameTwo)!.scheduledStart = new Date(now + 15 * 60000).toISOString();
  await page.reload();
  const picker = page.getByRole("combobox", { name: "Game", exact: true });
  await expect(picker).toHaveValue(gameTwo);
  await picker.selectOption(gameOne);
  await expect(page.getByLabel("Numeric grade")).toBeDisabled();
  await expect(page.getByText(/A later game is due/)).toBeVisible();
  games.get(gameOne)!.state.status = "closed";
  await page.reload();
  await picker.selectOption(gameOne);
  await expect(page.getByLabel("Numeric grade")).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Reopen coaching session" }),
  ).toHaveCount(0);
  await picker.selectOption(gameTwo);
  await expect(page.getByLabel("Numeric grade")).toBeEnabled();
});
