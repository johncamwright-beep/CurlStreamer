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
test("dashboard separates reported broadcasts, upcoming games and unfinished games", async ({
  page,
}, info) => {
  await expect(
    page.getByRole("heading", { name: "Games", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Broadcast activity" }),
  ).toBeVisible();
  await expect(page.getByText("YouTube · reported live")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Watch on YouTube/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=liveabcdefgh");
  await expect(page.getByRole("link", { name: /^Unfinished/ })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Benning/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: /^Unfinished/ }).click();
  await expect(
    page.getByRole("heading", { name: "Unfinished games", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Team Epping", { exact: true })).toBeVisible();
  await expect(page.getByText("Opponent TBD", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*TBD/ }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath(`dashboard-unfinished-${info.project.name}.png`),
    fullPage: true,
  });
});
test("results distinguish no-result and historical closure and retain safe replay links", async ({
  page,
}, info) => {
  await page
    .getByRole("navigation", { name: "Browse games" })
    .getByRole("link", { name: /^Results/ })
    .click();
  await expect(
    page.getByLabel("Northern Ontario Curling Club final score: 7"),
  ).toHaveText("7");
  await expect(page.getByText("No result", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Closed · no final result", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Watch replay/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=abcdefghijk");
  await page.screenshot({
    path: info.outputPath(`dashboard-results-${info.project.name}.png`),
    fullPage: true,
  });
  await page
    .getByLabel("Choose season")
    .selectOption("44444444-4444-4444-8444-444444444444");
  await page.getByRole("button", { name: "View season" }).click();
  await expect(
    page.getByText("Last season opponent", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Team Gushue", { exact: true })).toHaveCount(0);
});
test("dashboard fits narrow phones and preserves reachable controls", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 800 });
  const cards = page.locator(".dashboard-game-card");
  await expect(cards.first()).toBeVisible();
  expect(
    await cards.evaluateAll((items) =>
      items.some((el) => el.getBoundingClientRect().right > innerWidth),
    ),
  ).toBe(false);
  expect(
    await page
      .locator(".games-dashboard")
      .evaluate((main) =>
        [...main.querySelectorAll("a,button,select,summary")]
          .filter(
            (el) =>
              el.getBoundingClientRect().height > 0 &&
              el.getBoundingClientRect().height < 44,
          )
          .map((el) => el.textContent),
      ),
  ).toEqual([]);
  await page.screenshot({
    path: info.outputPath(`dashboard-narrow-${info.project.name}.png`),
    fullPage: true,
  });
});

test("event filter follows the selected event across game views and resets", async ({
  page,
}) => {
  const filter = page.getByLabel("Filter by event");
  await filter.selectOption({ label: "Autumn Club Championship" });
  await expect(page).toHaveURL(/event=55555555/);
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Wright/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Open Game:.*Team Benning/ }),
  ).toHaveCount(0);
  await page.getByRole("link", { name: /^Results/ }).click();
  await expect(filter).toHaveValue("55555555-5555-4555-8555-555555555555");
  await expect(
    page.getByText("No games match this event in this view.", { exact: false }),
  ).toBeVisible();
  await filter.selectOption("");
  await expect(page.getByText("Team Gushue", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: /^Upcoming/ }).click();
  await expect(
    page.getByRole("heading", { name: "Upcoming games", exact: true }),
  ).toBeVisible();
  await filter.selectOption("single");
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

async function dashboardCounts(
  page: Page,
  upcoming: number,
  results: number,
  unfinished: number,
) {
  const browse = page.getByRole("navigation", { name: "Browse games" });
  for (const [name, count] of [
    ["Upcoming", upcoming],
    ["Events", 1],
    ["Results", results],
    ["Unfinished", unfinished],
  ] as const)
    await expect(
      browse
        .getByRole("link", { name: new RegExp(`^${name}`) })
        .locator("span"),
    ).toHaveText(String(count));
}

async function endFixtureGame(page: Page) {
  await page.getByRole("button", { name: "End Game", exact: true }).click();
  await page
    .getByRole("button", { name: "Review final score", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Confirm End Game", exact: true }),
  ).toBeVisible();
  const committed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/completion") &&
      response.request().method() === "POST" &&
      response.request().postDataJSON()?.action === "complete",
  );
  await page
    .getByRole("button", { name: "Confirm End Game", exact: true })
    .click();
  expect((await committed).ok()).toBe(true);
  await expect(
    page.getByRole("link", { name: "Back to Games", exact: true }),
  ).toBeVisible();
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
      await dashboardCounts(
        page,
        scenario.days > 0 ? 1 : 0,
        0,
        scenario.days < 0 ? 1 : 0,
      );
      // Populate the Results route cache before completion as well.
      await page
        .getByRole("navigation", { name: "Browse games" })
        .getByRole("link", { name: /^Results/ })
        .click();
      await expect(
        page.getByRole("heading", { name: "Results will appear here" }),
      ).toBeVisible();
      await page
        .getByRole("navigation", { name: "Browse games" })
        .getByRole("link", {
          name: new RegExp(`^${scenario.days > 0 ? "Upcoming" : "Unfinished"}`),
        })
        .click();
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
      await dashboardCounts(page, 0, 1, 0);
      await expect(page.getByLabel("Filter by event")).toHaveValue(
        fixture.eventId,
      );
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
      await page
        .getByRole("navigation", { name: "Browse games" })
        .getByRole("link", { name: /^Results/ })
        .click();
      await expect(
        page.getByText("Refresh regression opponent", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Northern Ontario Curling Club final score: 6"),
      ).toHaveText("6");
      await page
        .getByRole("navigation", { name: "Browse games" })
        .getByRole("link", { name: /^Events/ })
        .click();
      await expect(
        page.getByText("No upcoming games", { exact: true }),
      ).toBeVisible();
      await dashboardCounts(page, 0, 1, 0);
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
    await dashboardCounts(page, 1, 0, 0);
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
    await dashboardCounts(page, 0, 1, 0);
    await expect(page.locator(".dashboard-event-next")).toHaveText(
      "No upcoming games",
    );
    await expect(page).toHaveURL(dashboardURL);
    await expect(page.getByLabel("Filter by event")).toHaveValue(
      fixture.eventId,
    );
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
