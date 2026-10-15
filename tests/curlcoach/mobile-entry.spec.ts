import { expect, test } from "@playwright/test";

test.use({ actionTimeout: 10000 });

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test("phone and desktop tabs preserve the whole shot, static context and fixed actions", async ({
  page,
}, info) => {
  test.setTimeout(90000);
  await page.setViewportSize({
    width: info.project.name === "phone" ? 390 : 1440,
    height: 844,
  });
  await page.goto("/curlcoach?event=practice#options");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("button", { name: "Save Options", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Metrics mode").selectOption("enhanced");
  await page.getByRole("button", { name: "Save Options", exact: true }).click();
  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Charting", exact: true })
    .click();
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
  await expect(
    page.getByRole("tab", { name: "Shot", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("Player", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const end = info.project.name === "phone" ? "15" : "16";
  await page.getByLabel("End", { exact: true }).fill(end);
  await page.getByLabel("Stone", { exact: true }).selectOption("1");
  await page
    .getByLabel("Throwing position", { exact: true })
    .selectOption("Lead");
  await page.getByRole("button", { name: "Close Change", exact: true }).click();
  await page
    .getByLabel("Shot type", { exact: true })
    .selectOption("Guard/Front Stone");
  await page.getByLabel("Shot subtype", { exact: true }).selectOption("guard");
  await page
    .getByLabel("Called weight", { exact: true })
    .selectOption({ label: "Guard 2" });
  await page
    .getByLabel("Shot difficulty", { exact: true })
    .selectOption("routine");
  await page.getByRole("tab", { name: "Execution", exact: true }).click();
  await expect(page.getByLabel("Shot type", { exact: true })).toBeHidden();
  await page.getByLabel("Numeric grade").selectOption("4");
  await page
    .getByLabel("Observed weight", { exact: true })
    .selectOption("button");
  await page.getByRole("tab", { name: "Technical", exact: true }).click();
  await page.getByLabel("Line", { exact: true }).selectOption("Wide");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await page
    .getByLabel("Private coaching note")
    .fill("Mobile tab preservation");
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByRole("tab", { name: "Notes", exact: true }).press("Home");
  await expect(
    page.getByRole("tab", { name: "Shot", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("Shot subtype", { exact: true })).toHaveValue(
    "guard",
  );
  const actions = page.locator(".coach-entry-actions");
  await expect(
    actions.getByRole("button", { name: "Save attempt", exact: true }),
  ).toHaveCount(0);
  const context = page.getByRole("region", { name: "Current shot context" });
  await page.evaluate(() => window.scrollTo(0, 0));
  const beforeRefresh = await context.boundingBox();
  await page.route("**/api/curlcoach/workspace?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  });
  await page.getByRole("button", { name: "Refresh event" }).click();
  const duringRefresh = await context.boundingBox();
  expect(duringRefresh!.y).toBeCloseTo(beforeRefresh!.y, 0);
  await expect(
    page.getByRole("button", { name: "Refresh event" }),
  ).toBeEnabled();
  expect((await context.boundingBox())!.y).toBeCloseTo(beforeRefresh!.y, 0);
  await page.unroute("**/api/curlcoach/workspace?**");
  const box = await actions.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(844);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `work/mobile-tabs-${info.project.name}.png`,
    fullPage: true,
  });
  await page.route("**/api/curlcoach/workspace", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 409,
        json: { error: "Simulated save conflict" },
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Next Turn", exact: true }).click();
  await expect(page.locator(".coach-save-error")).toHaveText(
    "Simulated save conflict",
  );
  await expect(context).toContainText(`End ${end}`);
  expect((await context.boundingBox())!.y).toBeCloseTo(beforeRefresh!.y, 0);
  await page.unroute("**/api/curlcoach/workspace");
  await page.getByRole("button", { name: "Next Turn", exact: true }).click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("Saved.");
  const gameControls = page.getByRole("button", {
    name: "Game controls",
    exact: true,
  });
  if (await gameControls.isVisible()) await gameControls.click();
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  const closeControls = page.getByRole("button", {
    name: "Close Game controls",
    exact: true,
  });
  if (await closeControls.isVisible()) await closeControls.click();
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText(`End ${end}`);
  await page.getByRole("tab", { name: "Execution", exact: true }).click();
  await expect(page.getByLabel("Numeric grade")).toHaveValue("4");
  await expect(page.getByLabel("Observed weight", { exact: true })).toHaveValue(
    "button",
  );
  await page.getByRole("tab", { name: "Technical", exact: true }).click();
  await expect(page.getByLabel("Line", { exact: true })).toHaveValue("Wide");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Mobile tab preservation",
  );
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.getByRole("tab", { name: "Shot", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page
    .getByRole("button", { name: "Go to current shot", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/curlcoach?event=practice#options");
  await page.getByLabel("Metrics mode").selectOption("standard");
  await page.getByRole("button", { name: "Save Options", exact: true }).click();
  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();
});
