import { expect, test, type Page } from "@playwright/test";
test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
async function open(page: Page, path = "/curlcoach") {
  await page.goto(path);
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("combobox", { name: "Game", exact: true }),
  ).toBeVisible();
}
async function navigate(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page.getByRole("link", { name, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}
test("five analysis pages preserve scope, show percentages and fit mobile", async ({
  page,
}, info) => {
  await open(page);
  await expect(
    page
      .getByRole("navigation", {
        name: "Shot Tracker pages",
        includeHidden: true,
      })
      .getByRole("link", { includeHidden: true }),
  ).toHaveCount(5);
  await navigate(page, "Shot performance");
  await expect(
    page.getByRole("heading", { name: "Performance by shot type" }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Team / player", exact: true })
    .selectOption("lead");
  await page.getByText("More filters", { exact: true }).click();
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await navigate(page, "Miss analysis");
  await expect(
    page.getByRole("combobox", { name: "Team / player", exact: true }),
  ).toHaveValue("lead");
  await expect(
    page.getByRole("combobox", { name: "Shot type", exact: true }),
  ).toHaveValue("Draw");
  await expect(
    page.getByRole("region", { name: "Miss breakdown", exact: true }),
  ).toContainText("Share of diagnosed misses");
  await page.getByRole("button", { name: "Reset more filters" }).click();
  await page
    .getByRole("checkbox", { name: "Compare with this season" })
    .check();
  await expect(
    page.getByRole("region", { name: "Selection versus season" }),
  ).toBeVisible();
  await page.screenshot({
    path: `work/analysis-misses-${info.project.name}.png`,
    fullPage: true,
  });
  await navigate(page, "Game analysis");
  await expect(
    page.getByRole("region", { name: "Shooting by end", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "With hammer", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Winning from a game situation" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `work/analysis-game-${info.project.name}.png`,
    fullPage: true,
  });
});
test("charting draft survives analysis navigation and season reads are cached", async ({
  page,
}) => {
  await open(page, "/curlcoach?event=practice#charting");
  if (
    await page
      .getByRole("button", { name: "Start Charting", exact: true })
      .isVisible()
  ) {
    await page
      .getByRole("button", { name: "Start Charting", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirm lineup & start", exact: true })
      .click();
  }
  await page.getByLabel("End", { exact: true }).fill("3");
  await page
    .getByLabel("Private coaching note")
    .fill("Keep this unsaved draft");
  let reads = 0;
  page.on("request", (request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/curlcoach/workspace")
    )
      reads++;
  });
  await navigate(page, "Shot performance");
  await page
    .getByRole("checkbox", { name: "Compare with this season" })
    .check();
  await expect(
    page.getByRole("region", { name: "Selection versus season" }),
  ).toBeVisible();
  await navigate(page, "Miss analysis");
  await navigate(page, "Game analysis");
  await navigate(page, "Charting");
  await expect(page.getByLabel("End", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Keep this unsaved draft",
  );
  expect(reads).toBe(1);
});
test("old analysis links resolve to the consolidated pages", async ({
  page,
}) => {
  await open(page, "/curlcoach#team-statistics");
  await expect(
    page.getByRole("heading", { name: "Shot performance", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => {
    location.hash = "end-by-end-scores";
  });
  await expect(
    page.getByRole("heading", { name: "Game analysis", exact: true }),
  ).toBeVisible();
});
