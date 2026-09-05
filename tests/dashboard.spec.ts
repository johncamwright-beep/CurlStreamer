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
    page.getByRole("link", { name: /Open YouTube/ }),
  ).toHaveAttribute("href", "https://www.youtube.com/watch?v=liveabcdefgh");
  await expect(
    page.getByText("2 unfinished games", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Scoring:.*Team Benning/ }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Review games →" }).click();
  await expect(
    page.getByRole("heading", { name: "Unfinished games", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Team Epping", { exact: true })).toBeVisible();
  await expect(page.getByText("Opponent TBD", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /^Assign Opponent:/ }),
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
