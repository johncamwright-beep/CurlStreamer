// Real scheduling/scoring/program components with explicit local API fixtures.
import { build } from "esbuild";
import { test, expect, type Page } from "@playwright/test";
import {
  fixtureOrganizer,
  installGameFixture,
} from "./support/game-browser-fixture";
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
              "export function useRouter(){return {push(path){window.location.assign(path)},refresh(){}}}",
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
  let created = false;
  await page.route("**/games/new", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="root"></main><script src="/fixture-schedule.js"></script>',
    }),
  );
  await page.route("**/fixture-schedule.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: scheduleBundle }),
  );
  await page.route("**/api/team-schedule", async (route) => {
    const body = route.request().postDataJSON();
    expect(body).toMatchObject({
      operation: "createGame",
      scheduledDate: "2026-11-01",
      scheduledTime: "13:00",
      timezone: "UTC",
      opponentName: "Stones",
    });
    game.config = { ...game.config, ...body.config };
    created = true;
    await route.fulfill({
      json: { game: { id: testGameId }, organizerToken: fixtureOrganizer },
    });
  });
  await page.goto("/games/new");
  await page
    .getByRole("textbox", { name: "New opponent name", exact: true })
    .fill("Stones");
  await page.locator('input[name="scheduledDate"]').fill("2026-11-01");
  await page.locator('input[name="scheduledTime"]').fill("13:00");
  await page
    .getByRole("button", { name: "Schedule game", exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/games/${testGameId}$`));
  expect(created).toBe(true);
  return game;
}

test("organizer schedules a game and sees role links with the local API fixture", async ({
  page,
}) => {
  await scheduleGame(page);
  await page
    .getByText("Invite devices & camera setup", { exact: true })
    .click();
  await page
    .getByRole("button", { name: "Create invitation", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Open role chooser", exact: true }),
  ).toBeVisible();
  await page.getByText("Individual invitation links", { exact: true }).click();
  await expect(
    page.getByRole("link", { name: "Camera 1 Invite", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Scorekeeper Invite", exact: true }),
  ).toBeVisible();
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
    .getByRole("button", { name: "Start carousel", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Stop carousel", exact: true }),
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
