// Real scheduling/scoring/program components with explicit local API fixtures.
import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import { installGameFixture } from "./support/game-browser-fixture";
import { testGameId } from "../src/test/game-fixture";

let scheduleBundle: string;
test.beforeAll(async () => {
  const props = {
    teamName: "Rocks",
    seasons: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "2026",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "active",
      },
    ],
    events: [],
    opponents: [],
    games: [],
  };
  const result = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {GameCreationForm} from './src/app/games/new/GameCreationForm'; createRoot(document.getElementById('root')).render(React.createElement(GameCreationForm, ${JSON.stringify(props)}));`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    plugins: [
      {
        name: "schedule-router-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export function useRouter(){return {replace(path){window.location.replace(path)},refresh(){}}}",
            loader: "js",
          }));
        },
      },
    ],
  });
  scheduleBundle = result.outputFiles[0].text;
});

async function scheduleGame(page: Page) {
  const game = await installGameFixture(page);
  const opponentId = "77777777-7777-4777-8777-777777777777";
  let created = false;
  let opponentCreated = false;
  await page.route("**/games/new", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script src="/fixture-schedule.js"></script>',
    }),
  );
  await page.route(/\/dashboard\?season=/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<h1>Games</h1><a href="/score/' + testGameId + '">Open game</a>',
    }),
  );
  await page.route("**/fixture-schedule.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: scheduleBundle }),
  );
  await page.route("**/api/team-schedule", async (route) => {
    const body = route.request().postDataJSON();
    if (body.operation === "createOpponentDetails") {
      expect(body.input).toMatchObject({
        displayName: "Stones",
        seasonId: "22222222-2222-4222-8222-222222222222",
        expectedRevision: 0,
      });
      opponentCreated = true;
      await route.fulfill({
        json: {
          opponent: { id: opponentId, displayName: "Stones" },
          profile: {
            opponent_id: opponentId,
            season_id: body.input.seasonId,
            level: body.input.level,
            roster: body.input.roster,
            revision: 1,
          },
        },
      });
      return;
    }
    expect(body).toMatchObject({
      operation: "createGame",
      scheduledDate: "2026-11-01",
      scheduledTime: "13:00",
      timezone: "America/Toronto",
      opponentId,
    });
    game.config = { ...game.config, ...body.config };
    created = true;
    await route.fulfill({
      json: { game: { id: testGameId } },
    });
  });
  await page.goto("/games/new");
  await page
    .getByRole("button", { name: "Create new opponent", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "New opponent" });
  await dialog
    .getByRole("textbox", { name: "Saved team name", exact: true })
    .fill("Stones");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Opponent", exact: true }),
  ).toHaveValue("Stones");
  await page.locator('input[name="scheduledDate"]').fill("2026-11-01");
  await page.locator('input[name="scheduledTime"]').fill("13:00");
  await page.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\?season=/);
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`curlcast-access-${id}`),
      testGameId,
    ),
  ).toBeNull();
  expect(created).toBe(true);
  expect(opponentCreated).toBe(true);
  return game;
}

test("organizer schedules a game, returns to Games, and opens scoring", async ({
  page,
}) => {
  await scheduleGame(page);
  await page.getByRole("link", { name: "Open game", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/score/" + testGameId + "$"));
  await expect(
    page.getByRole("button", { name: "Save 1 point", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Device readiness" }),
  ).toHaveCount(0);
});

test("scoring updates the contained program and sponsor display with the local API fixture", async ({
  page,
}) => {
  const game = await scheduleGame(page);
  await page.goto(`/score/${testGameId}`);
  await page.getByRole("button", { name: "Save 1 point", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "End 1 saved." }),
  ).toBeVisible();
  expect(game.scoreEvents).toHaveLength(1);
  await page
    .getByRole("button", { name: "Start sponsors", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop sponsors", exact: true }),
  ).toBeVisible();
  await page.goto(`/broadcast/${testGameId}`);
  const canvas = page.getByTestId("broadcast-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box!.width / box!.height).toBeCloseTo(16 / 9, 2);
  await expect(page.getByText("END 2", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", { name: "Community", exact: true }),
  ).toBeVisible();
});
