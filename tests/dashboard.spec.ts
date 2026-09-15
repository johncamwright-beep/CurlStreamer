import { expect, test } from "@playwright/test";

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
