import { expect, test } from "@playwright/test";
test.skip(
  !process.env.CURLCOACH_E2E,
  "Run with playwright.curlcoach.config.ts",
);
test("scoped local lab charts, corrects and audits a synthetic shot", async ({
  page,
  request,
}, testInfo) => {
  expect((await request.get("/api/curlcoach/game")).status()).toBe(401);
  await page.goto("/curlcoach?event=practice#scoring");
  await page
    .getByLabel("Local lab key")
    .fill("curlcoach-e2e-only-key-thirty-two-characters");
  await page.getByRole("button", { name: "Unlock lab" }).click();
  await expect(
    page.getByRole("button", { name: "Save attempt", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("End", { exact: true }).fill("20");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page.getByLabel("Numeric grade").selectOption("5");
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(page.locator(".coach-scoring [role=status]")).toHaveText(
    "Attempt saved. Report updated.",
  );
  const attempt = page.locator(".coach-attempt").filter({ hasText: "End 20" });
  await expect(attempt).toContainText("5/5");
  await attempt.getByRole("button", { name: "Correct", exact: true }).click();
  await page.getByLabel("Numeric grade").selectOption("0");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(attempt).toContainText("0/5");
  await page.getByRole("button", { name: /Revision history/ }).click();
  await expect(
    page.locator("li").filter({ hasText: "Grade: 5/5" }).first(),
  ).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "Grade: 0/5" }).first(),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/curlcoach-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await attempt.getByRole("button", { name: "Remove attempt" }).click();
  await expect(attempt).toHaveCount(0);
  await page.getByRole("button", { name: "Undo latest change" }).click();
  await expect(attempt).toContainText("0/5");
  await page.reload();
  await expect(attempt).toContainText("0/5");
  for (const control of await page
    .locator(".coach-lab button, .coach-lab input, .coach-lab select")
    .all()) {
    const box = await control.boundingBox();
    if (box) expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await attempt.getByRole("button", { name: "Remove attempt" }).click();
  await expect(attempt).toHaveCount(0);
  await page.getByLabel("End", { exact: true }).fill("19");
  await page.getByLabel("Flag shot for review").check();
  await page.getByLabel("Go back (seconds)").fill("45");
  await page.getByLabel("Private coaching note").fill("Review the line call");
  await page
    .getByRole("combobox", { name: "Stone", exact: true })
    .selectOption("1");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page.getByLabel("Numeric grade").selectOption("5");
  await page.route("**/api/curlcoach/workspace", async (route) => {
    if (route.request().method() === "POST")
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "Test save conflict" }),
      });
    else await route.continue();
  });
  await page.getByRole("button", { name: "Next turn" }).click();
  await expect(page.locator(".coach-scoring [role=status]")).toContainText(
    "Test save conflict",
  );
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("1");
  await page.unroute("**/api/curlcoach/workspace");
  await page.getByRole("button", { name: "Next turn" }).click();
  await expect(
    page.getByRole("combobox", { name: "Stone", exact: true }),
  ).toHaveValue("2");
  await expect(page.getByLabel("Numeric grade")).toHaveValue("");
  await expect(page.getByLabel("Flag shot for review")).not.toBeChecked();
  await expect(
    page.getByRole("region", { name: "Game review summary" }),
  ).toContainText("Review the line call");
  await expect(
    page.getByRole("region", { name: "Game review summary" }),
  ).toContainText("Go back 45 seconds");
  await expect(
    page.getByRole("region", { name: "Game review summary" }),
  ).toContainText("Flag captured");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await page.getByLabel("Numeric grade").selectOption("4");
  await page.getByRole("button", { name: "Next turn" }).click();
  await expect(
    page.getByRole("combobox", { name: "Throwing position", exact: true }),
  ).toHaveValue("Second");
  await expect(
    page.getByRole("combobox", { name: "Player", exact: true }),
  ).toHaveValue("second");
  await page.screenshot({
    path: `test-results/compact-scoring-${testInfo.project.name}.png`,
    fullPage: true,
  });
  for (let i = 0; i < 2; i++) {
    await page
      .locator(".coach-attempt")
      .filter({ hasText: "End 19" })
      .first()
      .getByRole("button", { name: "Remove attempt" })
      .click();
    await expect(
      page.locator(".coach-attempt").filter({ hasText: "End 19" }),
    ).toHaveCount(1 - i);
  }
});
