import { expect, test } from "@playwright/test";

test.skip(
  process.env.YOUTUBE_SETTINGS_E2E !== "1",
  "Uses isolated public team page fixture",
);

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
