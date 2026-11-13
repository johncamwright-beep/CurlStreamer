import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { APIRequestContext, Page } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses the isolated authenticated Supabase fixture",
);
test.beforeEach(async ({ page }) => {
  await page.goto("/login?next=/dashboard");
  await page.getByLabel("Email address").fill("admin@youtube.test");
  await page.getByLabel("Password").fill("playwright-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
});
test("dashboard shows each game once by default and filters unfinished games", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  const view = page.getByLabel("Games view");
  await expect(view).toHaveValue("all");
  const rows = page.locator(".dashboard-game-card");
  await expect(rows).toHaveCount(8);
  await expect(page.locator(".dashboard-game-count")).toHaveText("8 games");
  const broadcast = rows.filter({ hasText: "Broadcast opponent" });
  await expect(broadcast).toHaveCount(1);
  await expect(broadcast.getByText("YouTube · reported live")).toBeVisible();
  await expect(
    broadcast.getByRole("link", { name: /Watch on YouTube/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=liveabcdefgh");
  await expect(
    broadcast.getByRole("link", { name: /^ShotTracker\b/ }),
  ).toHaveAttribute(
    "href",
    "/shot-tracker?source=streamer&event=standalone&game=66666666-6666-4666-8666-000000000008#charting",
  );
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Benning/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Team Gushue game details" }),
  ).toBeVisible();
  await view.selectOption("unfinished");
  await expect(page).toHaveURL(/tab=unfinished/);
  await expect(page.getByText("Team Epping", { exact: true })).toBeVisible();
  await expect(page.getByText("Opponent TBD", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*TBD/ }),
  ).toBeVisible();
  await expect(page.getByText("Team Benning", { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath(`dashboard-unfinished-${info.project.name}.png`),
    fullPage: true,
  });
});
test("results distinguish no-result and historical closure and retain safe replay links", async ({
  page,
}, info) => {
  await page.getByLabel("Games view").selectOption("past");
  await expect(
    page.getByLabel("Northern Ontario Curling Club final score: 7"),
  ).toHaveText("7");
  await expect(page.getByText("No result", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Closed · no final result", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /^Replay\b/ })).toHaveAttribute(
    "href",
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  await page.screenshot({
    path: info.outputPath(`dashboard-results-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByLabel("Choose season")
    .selectOption("44444444-4444-4444-8444-444444444444");
  await expect(
    page.getByText("Last season opponent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Team Gushue", { exact: true })).toHaveCount(0);
});

test("reopens a completed game from its More actions menu", async ({
  page,
}, info) => {
  if (info.project.name === "desktop")
    await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByLabel("Games view").selectOption("past");
  await expect(page.locator(".dashboard-game-count")).toHaveText("3 games");
  const detailsLink = page.getByRole("link", {
    name: "Team Gushue game details",
  });
  await expect(detailsLink).toBeVisible();
  const gameId = (await detailsLink.getAttribute("href"))!.split("/").at(-1)!;
  const card = page
    .locator(".dashboard-game-card")
    .filter({ has: detailsLink });
  const menu = card.locator("summary");
  const reopen = card.getByRole("button", {
    name: "Reopen scoring",
    exact: true,
  });
  const dialog = page.getByRole("dialog", { name: "Reopen scoring" });
  await expect(menu).toHaveAttribute("aria-label", "More actions");
  await expect(reopen).toBeHidden();
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(reopen).toBeVisible();
  await expect(card.getByRole("link", { name: "Edit game" })).toHaveAttribute(
    "href",
    `/games/${gameId}/edit`,
  );
  if (info.project.name === "desktop")
    await page.screenshot({
      path: info.outputPath("dashboard-results-menu-desktop.png"),
      fullPage: true,
    });
  await reopen.focus();
  await page.keyboard.press("Escape");
  await expect(reopen).toBeHidden();
  await expect(menu).toBeFocused();
  await menu.click();
  const deletion = page.getByRole("dialog", { name: /^Delete game:/i });
  await card.getByRole("button", { name: "Delete Game", exact: true }).click();
  await expect(deletion).toBeVisible();
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(deletion).toBeHidden();
  await reopen.click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toBeHidden();

  await page.route(`**/api/games/${gameId}/result`, (route) =>
    route.fulfill({ json: { revision: 42 } }),
  );
  await page.route(`**/api/games/${gameId}/reopen`, (route) =>
    route.fulfill({ json: { status: "active", gameId } }),
  );
  await page.route(`**/score/${gameId}`, (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Scoring</h1>" }),
  );
  if (!(await reopen.isVisible())) await menu.click();
  await reopen.click();
  const request = page.waitForRequest(`**/api/games/${gameId}/reopen`);
  await dialog.getByRole("button", { name: "Reopen and continue" }).click();
  expect((await request).postDataJSON()).toMatchObject({
    expectedRevision: 42,
    requestId: expect.any(String),
  });
  await expect(page).toHaveURL(new RegExp(`/score/${gameId}$`));
});

test("dashboard fits narrow phones and preserves reachable controls", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const heading = page.locator(".dashboard-heading");
  const teamName = heading.locator(".dashboard-team-title");
  expect(
    await teamName.evaluate((element) => {
      const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
      return element.getBoundingClientRect().height / lineHeight;
    }),
  ).toBeLessThanOrEqual(3.01);
  const season = await heading.getByLabel("Choose season").boundingBox();
  const createGame = await heading
    .getByRole("link", { name: /Create game/ })
    .boundingBox();
  expect(
    season &&
      createGame &&
      (season.x + season.width <= createGame.x ||
        createGame.x + createGame.width <= season.x ||
        season.y + season.height <= createGame.y ||
        createGame.y + createGame.height <= season.y),
  ).toBe(true);
  const cards = page.locator(".dashboard-game-card");
  await expect(cards.first()).toBeVisible();
  const trackerLinks = cards.getByRole("link", { name: /^ShotTracker\b/ });
  await expect(trackerLinks).toHaveCount(await cards.count());
  await expect(trackerLinks.first()).toBeVisible();
  await expect(trackerLinks.first()).toHaveText("ShotTracker");
  expect(
    await cards.evaluateAll((items) =>
      items.some((el) => el.getBoundingClientRect().right > innerWidth),
    ),
  ).toBe(false);
  expect(
    await page
      .locator(".games-dashboard")
      .evaluate((main) =>
        [...main.querySelectorAll("a,button,select,summary,input[type=search]")]
          .filter(
            (el) =>
              el.getBoundingClientRect().height > 0 &&
              el.getBoundingClientRect().height < 44,
          )
          .map((el) => el.textContent),
      ),
  ).toEqual([]);
  const menu = cards.first().locator(".dashboard-more");
  await menu.locator("summary").click();
  const menuPanel = menu.locator(".dashboard-more-popover");
  await expect(menuPanel).toBeVisible();
  expect(
    await menuPanel.evaluate((panel) => {
      const { left, right } = panel.getBoundingClientRect();
      return left >= 0 && right <= innerWidth;
    }),
  ).toBe(true);
  await menu.locator("summary").click();
  await expect(menuPanel).toBeHidden();
  await page.screenshot({
    path: info.outputPath(`dashboard-narrow-${info.project.name}.png`),
    fullPage: true,
  });
  await trackerLinks.first().click();
  await expect(page).toHaveURL(/\/shot-tracker\?source=streamer/);
  await expect(
    page.getByText(/Shot Tracker requires a CurlStreamer add-on subscription/),
  ).toBeVisible();
  const subscription = page.getByRole("link", {
    name: "View trial & subscription",
  });
  await expect(subscription).toHaveAttribute(
    "href",
    "/account?section=subscription",
  );
  await subscription.click();
  await expect(page).toHaveURL(/\/account\?section=subscription$/);
});

test("team walkthrough starts collapsed and stays dismissed after reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const region = page.getByRole("region", { name: "Team setup" });
  const summary = region.locator("summary");
  const checklist = region.getByRole("list");
  await expect(summary).toHaveText("Complete your team setup – walkthrough");
  await expect(checklist).toBeHidden();
  await expect.poll(async () => (await region.boundingBox())?.height).toBe(44);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(checklist).toBeVisible();
  await expect(checklist.getByRole("link")).toHaveCount(5);
  await expect(region.getByText("Team setup · 2/5 ready")).toBeVisible();
  await region.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(region).toBeHidden();
  await page.reload();
  await expect(region).toBeHidden();
});

test("search, chronological sort and tournament filters work together", async ({
  page,
}) => {
  const view = page.getByLabel("Games view");
  const sort = page.getByLabel("Sort games");
  const search = page.getByLabel("Search teams or events");
  const rows = page.locator(".dashboard-game-card");
  await expect(sort).toHaveValue("newest");
  await search.fill("team");
  await search.press("Enter");
  await expect(rows).toHaveCount(4);
  await expect(page.locator(".dashboard-game-count")).toHaveText("4 games");
  await expect(rows.first()).toContainText("Team Wright");
  await sort.selectOption("oldest");
  await expect(rows.first()).toContainText("Team Gushue");
  await search.fill("Autumn Club Championship");
  await search.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText("Team Wright");
  await rows
    .getByRole("link", { name: "Autumn Club Championship", exact: true })
    .click();
  await expect(page).toHaveURL(/event=55555555/);
  await expect(search).toHaveValue("");
  await expect(sort).toHaveValue("oldest");
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Wright/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Benning/ }),
  ).toHaveCount(0);
  await view.selectOption("past");
  await expect(
    page.getByRole("link", { name: "Clear event filter" }),
  ).toBeVisible();
  await expect(rows).toHaveCount(0);
  await page.getByRole("link", { name: "Clear event filter" }).click();
  await expect(page.getByText("Team Gushue", { exact: true })).toBeVisible();
  await view.selectOption("single");
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Benning/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Wright/ }),
  ).toHaveCount(0);
});

test("account logo aligns with content across page widths", async ({
  page,
}, info) => {
  if (info.project.name === "desktop")
    await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  const origin = new URL(page.url()).origin;
  for (const path of [
    "/dashboard",
    "/account",
    "/games/new",
    "/settings/youtube",
  ]) {
    if (path !== "/dashboard") await page.goto(new URL(path, origin).href);
    const shortcut = page.getByRole("link", {
      name: "My account",
      exact: true,
    });
    await expect(shortcut).toBeVisible();
    await expect
      .poll(() =>
        shortcut.evaluate((element) => {
          const main = element.closest("main")!;
          const contentRight =
            main.getBoundingClientRect().right -
            parseFloat(getComputedStyle(main).paddingRight);
          return Math.abs(element.getBoundingClientRect().right - contentRight);
        }),
      )
      .toBeLessThan(2);
    expect(await page.evaluate(() => document.body.style.paddingRight)).toBe(
      "",
    );
    if (path === "/dashboard")
      await page.screenshot({
        path: info.outputPath("aligned-logo.png"),
        fullPage: true,
      });
  }
});

const fixtureURL = `http://127.0.0.1:${process.env.YOUTUBE_MOCK_PORT ?? 3101}/__dashboard-completion-fixture`;

async function completionFixture(request: APIRequestContext, days: number) {
  const fixture = {
    seasonId: randomUUID(),
    eventId: randomUUID(),
    gameId: randomUUID(),
    days,
  };
  const response = await request.post(fixtureURL, { data: fixture });
  expect(response.ok()).toBe(true);
  return fixture;
}

async function endFixtureGame(page: Page) {
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  await page.getByRole("button", { name: "Yes", exact: true }).click();
  const scoreDialog = page.getByRole("dialog", {
    name: /^Finalize game score \d+–\d+\?$/,
  });
  const committed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/completion") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "complete",
  );
  await scoreDialog.getByRole("button", { name: "Yes", exact: true }).click();
  expect((await committed).ok()).toBe(true);
  await expect(page).toHaveURL(/\/dashboard$/);
}

for (const scenario of [
  { name: "upcoming", days: 2, tab: "upcoming" },
  { name: "unfinished", days: -2, tab: "unfinished" },
] as const) {
  test(`confirmed End Game refreshes cached ${scenario.name} dashboard on browser Back`, async ({
    page,
    request,
  }) => {
    const fixture = await completionFixture(request, scenario.days);
    try {
      await page.goto(
        `/dashboard?season=${fixture.seasonId}&event=${fixture.eventId}&tab=${scenario.tab}`,
      );
      const view = page.getByLabel("Games view");
      const rows = page.locator(".dashboard-game-card");
      await expect(rows).toHaveCount(1);
      // Populate the Results route cache before completion as well.
      await view.selectOption("past");
      await expect(rows).toHaveCount(0);
      await view.selectOption(scenario.tab);
      await expect(page).toHaveURL(new RegExp(`tab=${scenario.tab}`));
      const dashboardURL = page.url();
      await page.evaluate(() =>
        Object.defineProperty(window, "dashboardRegressionDocument", {
          value: true,
        }),
      );
      await page
        .getByRole("link", { name: /^Open Game:.*Refresh regression opponent/ })
        .click();
      await endFixtureGame(page);
      await page.goBack();
      await expect(page).toHaveURL(dashboardURL);
      await expect(rows).toHaveCount(0);
      await expect(view).toHaveValue(scenario.tab);
      await expect(
        page.getByRole("link", { name: "Clear event filter" }),
      ).toBeVisible();
      await expect(
        page.getByRole("link", {
          name: /^Open Game:.*Refresh regression opponent/,
        }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          Object.hasOwn(window, "dashboardRegressionDocument"),
        ),
      ).toBe(true);
      await view.selectOption("past");
      await expect(
        page.getByText("Refresh regression opponent", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Northern Ontario Curling Club final score: 6"),
      ).toHaveText("6");
      await view.selectOption("events");
      await expect(
        page.getByText("No upcoming games", { exact: true }),
      ).toBeVisible();
    } finally {
      await request.delete(fixtureURL, {
        data: { seasonId: fixture.seasonId },
      });
    }
  });
}

test("an already open dashboard receives another tab's committed End Game without losing filters or refreshing repeatedly", async ({
  page,
  context,
  request,
}) => {
  const fixture = await completionFixture(request, 2);
  const gamePage = await context.newPage();
  try {
    await page.goto(
      `/dashboard?season=${fixture.seasonId}&event=${fixture.eventId}&tab=events`,
    );
    await expect(page.locator(".dashboard-event-next")).toContainText("Next:");
    const dashboardURL = page.url();
    await gamePage.goto(`/games/${fixture.gameId}`);
    // Keep the dashboard visible so notification, rather than a focus event,
    // is responsible for updating the already mounted server projection.
    await page.bringToFront();
    let reads = 0;
    page.on("request", (r) => {
      if (new URL(r.url()).pathname === "/dashboard" && r.headers().rsc === "1")
        reads++;
    });
    await endFixtureGame(gamePage);
    await expect(page.locator(".dashboard-event-next")).toHaveText(
      "No upcoming games",
    );
    await expect(page).toHaveURL(dashboardURL);
    await expect(
      page.getByRole("link", { name: "Clear event filter" }),
    ).toBeVisible();
    const settledReads = reads;
    await page.waitForTimeout(1500);
    expect(reads).toBe(settledReads);
    expect(reads).toBeGreaterThan(0);
    expect(reads).toBeLessThanOrEqual(3);
  } finally {
    await gamePage.close();
    await request.delete(fixtureURL, { data: { seasonId: fixture.seasonId } });
  }
});
