import { expect, test } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the CurlCoach config");
test("seven-game workspace navigation, player/game filters and source availability", async ({
  page,
}, info) => {
  await page.goto("/curlcoach");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(page.getByText("7 games in event")).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "CurlCoach pages" }).getByRole("link"),
  ).toHaveCount(6);
  await page.screenshot({
    path: `test-results/event-setup-${info.project.name}.png`,
  });
  await page.getByRole("link", { name: /Data tables/ }).click();
  await expect(
    page.getByRole("heading", { name: "Turn / deficiency", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".event-metrics")).toContainText("448");
  await page.getByRole("button", { name: "Alex (Lead)", exact: true }).click();
  await expect(page.locator(".event-metrics")).toContainText("112");
  await page.getByRole("link", { name: /Team$/ }).click();
  await expect(
    page.getByRole("heading", { name: "Alex (Lead) · all 7 games" }),
  ).toBeVisible();
  await expect(page.locator(".event-bars > div")).toHaveCount(7);
  await page.screenshot({
    path: `test-results/event-team-${info.project.name}.png`,
  });
  await page.getByRole("link", { name: /Game analysis/ }).click();
  await page
    .getByRole("combobox", { name: "Game", exact: true })
    .selectOption("shorty-example-7");
  await expect(
    page.getByRole("heading", { name: "Game 7 · vs Example team 7" }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Scoreboard analysis/ }).click();
  await expect(
    page.getByRole("heading", { name: "Event score difference / hammer" }),
  ).toBeVisible();
  await expect(page.getByText("Pending rule")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/event-scoreboard-${info.project.name}.png`,
  });
  await page
    .getByRole("combobox", { name: "Data source", exact: true })
    .selectOption("streamer");
  await expect(
    page.getByRole("heading", { name: "Event data is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Streamer is not connected",
  );
});
