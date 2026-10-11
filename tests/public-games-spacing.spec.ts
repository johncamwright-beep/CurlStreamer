import { expect, test } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated public team page fixture",
);

test("active event shows scores and schedule and can switch back to all games", async ({
  page,
}, testInfo) => {
  await page.goto("/teams/public-active-preview");
  const games = page.getByRole("region", { name: "Team games", exact: true });
  await expect(games.getByLabel("Show games")).toHaveValue("auto");
  await expect(
    games.getByRole("heading", { name: "Shorty Jenkin", exact: true }),
  ).toBeVisible();
  const schedule = games.getByRole("region", {
    name: "Event schedule",
    exact: true,
  });
  const scores = games.getByRole("region", {
    name: "Event scores",
    exact: true,
  });
  await expect(schedule.locator("article")).toHaveCount(4);
  await expect(scores.locator("article")).toHaveCount(3);
  await expect(
    schedule.getByRole("link", { name: "Watch on YouTube" }),
  ).toBeVisible();
  await expect(
    scores.getByRole("link", { name: "Watch replay" }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await games.screenshot({ path: testInfo.outputPath("active-event.png") });
  await games.getByLabel("Show games").selectOption("results");
  await expect(games.getByLabel("Event", { exact: true })).toBeVisible();
  await expect(
    games.getByRole("region", { name: "Filtered games" }).locator("article"),
  ).toHaveCount(7);
  await games.getByLabel("Show games").selectOption("auto");
  await expect(schedule).toBeVisible();
});

test("public game scores and replay links remain clear of the scrollbar", async ({
  page,
}, testInfo) => {
  await page.goto("/teams/public-preview");
  const games = page.getByRole("region", { name: "Team games", exact: true });
  await games.getByLabel("Show games").selectOption("results");
  const scroll = games.getByRole("region", { name: "Filtered games" });
  await expect(
    scroll.getByRole("link", { name: "Watch replay" }).first(),
  ).toBeVisible();
  expect(
    await scroll.evaluate((element) => element.scrollHeight),
  ).toBeGreaterThan(await scroll.evaluate((element) => element.clientHeight));
  expect(
    await scroll.evaluate((element) => {
      const right = element.getBoundingClientRect().right;
      return [...element.querySelectorAll("article")].every(
        (row) => right - row.getBoundingClientRect().right >= 19,
      );
    }),
  ).toBe(true);
  await scroll.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect(
    scroll.getByRole("link", { name: "Watch replay" }).last(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await games.screenshot({
    path: testInfo.outputPath("public-games-scrollbar.png"),
  });
});
