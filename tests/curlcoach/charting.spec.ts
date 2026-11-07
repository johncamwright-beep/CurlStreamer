import { openEntryTab } from "./entry-tabs";
import { expect, test } from "@playwright/test";
// Shared tabbed entry regression coverage; phone and desktop layout is exercised in mobile-entry.spec.ts.
test.use({ viewport: { width: 820, height: 1180 } });

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
    page.getByRole("button", { name: /^(Start Charting|Edit lineup)$/ }),
  ).toBeVisible();
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
    page.getByRole("button", { name: "Next Turn", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("End", { exact: true }).fill("20");
  await page
    .getByRole("dialog", { name: "Change", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Stone", exact: true, includeHidden: true })
    .selectOption("1");
  await page
    .getByRole("dialog", { name: "Change", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await openEntryTab(page, "Execution");
  await page.getByLabel("Numeric grade").selectOption("5");
  await openEntryTab(page, "Technical");
  for (const field of ["Line", "Release", "Technical"]) {
    await expect(
      page.getByRole("combobox", { name: field, exact: true }),
    ).toHaveValue("");
  }
  await openEntryTab(page, "Technical");
  await page
    .getByRole("combobox", { name: "Line", exact: true })
    .selectOption("Wide");
  await openEntryTab(page, "Technical");
  await page
    .getByRole("combobox", { name: "Release", exact: true })
    .selectOption("Soft");
  await openEntryTab(page, "Technical");
  await page
    .getByRole("combobox", { name: "Technical", exact: true })
    .selectOption("Understep");
  await page.getByRole("button", { name: "Next Turn", exact: true }).click();
  await expect(page.locator(".coach-scoring [role=status]")).toContainText(
    "Saved.",
  );
  const attempt = page.locator(".coach-attempt").filter({ hasText: "End 20" });
  await expect(attempt).toContainText("5/5");
  await page.getByRole("button", { name: "Shot Tracker menu" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Analysis", exact: true })
    .click();
  await page
    .getByRole("tab", { name: "Technical Review", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Line accuracy", exact: true }),
  ).toBeVisible();
  await openEntryTab(page, "Technical");
  await expect(
    page
      .getByRole("region", { name: "Line accuracy", exact: true })
      .locator(".analysis-bar")
      .filter({ hasText: "Wide" }),
  ).toContainText("100.0%");
  await page.screenshot({
    path: `test-results/technical-review-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Shot Tracker menu" }).click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Charting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Technical");
  await expect(
    page.getByRole("combobox", { name: "Line", exact: true }),
  ).toHaveValue("Wide");
  await openEntryTab(page, "Technical");
  await expect(
    page.getByRole("combobox", { name: "Release", exact: true }),
  ).toHaveValue("Soft");
  await openEntryTab(page, "Technical");
  await expect(
    page.getByRole("combobox", { name: "Technical", exact: true }),
  ).toHaveValue("Understep");
  await page.getByRole("button", { name: "Go to current shot" }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Stone",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveValue("2");
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Execution");
  await page.getByLabel("Numeric grade").selectOption("0");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(attempt).toContainText("0/5");
  await expect(
    page.getByRole("button", { name: "Undo latest change" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Revision history/ }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("End", { exact: true }).fill("3");
  await page.getByRole("button", { name: "Close Change", exact: true }).click();
  await page
    .getByRole("button", { name: "Resume tracking", exact: true })
    .click();
  await openEntryTab(page, "Execution");
  await expect(page.getByLabel("Numeric grade")).toHaveValue("0");
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText("End 20");
  await expect(page.getByText("Every shot tells a story.")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/curlcoach-${testInfo.project.name}.png`,
    fullPage: false,
  });
  await attempt.getByRole("button", { name: "Remove attempt" }).click();
  await expect(attempt).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Recorded shots", exact: true })
    .click();
  await page.reload();
  await expect(attempt).toHaveCount(0);
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page.getByLabel("End", { exact: true }).fill("19");
  await page
    .getByRole("dialog", { name: "Change", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await openEntryTab(page, "Notes");
  await page.getByLabel("Flag shot for review").selectOption("yes");
  for (const [label, seconds] of [
    ["30s", "30"],
    ["45s", "45"],
    ["60s", "60"],
    ["90s", "90"],
    ["2m", "120"],
    ["3m", "180"],
    ["4m", "240"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await expect(page.getByLabel("Go back (seconds)")).toHaveValue(seconds);
  }
  await page.getByLabel("Go back (seconds)").fill("31");
  await expect(
    page.getByRole("button", { name: "30s", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("button", { name: "45s", exact: true }).click();
  await openEntryTab(page, "Notes");
  await page.getByLabel("Private coaching note").fill("Review the line call");
  await openEntryTab(page, "Shot");
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Turn / target", exact: true })
    .selectOption({
      value: "CW C IO",
    });
  await openEntryTab(page, "Shot");
  await expect(
    page.getByRole("combobox", { name: "Turn / target", exact: true }),
  ).toHaveValue("CW C IO");
  await page.getByRole("button", { name: "Change", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Stone", exact: true, includeHidden: true })
    .selectOption("1");
  await page
    .getByRole("dialog", { name: "Change", exact: true })
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await openEntryTab(page, "Execution");
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
  await page.getByRole("button", { name: "Next Turn" }).click();
  await expect(page.locator(".coach-scoring [role=status]")).toContainText(
    "Test save conflict",
  );
  await expect(
    page.getByRole("combobox", {
      name: "Stone",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveValue("1");
  await page.unroute("**/api/curlcoach/workspace");
  await page.getByRole("button", { name: "Next Turn" }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Stone",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveValue("2");
  await openEntryTab(page, "Execution");
  await expect(page.getByLabel("Numeric grade")).toHaveValue("");
  await openEntryTab(page, "Technical");
  for (const field of ["Line", "Release", "Technical"]) {
    await expect(
      page.getByRole("combobox", { name: field, exact: true }),
    ).toHaveValue("");
  }
  await openEntryTab(page, "Notes");
  await expect(page.getByLabel("Flag shot for review")).toHaveValue("no");
  await page
    .getByRole("button", { name: "Flagged shots", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Game review summary" }),
  ).toContainText("Review the line call");
  await expect(
    page.getByRole("region", { name: "Game review summary" }),
  ).toContainText("No recording is linked to this game yet.");
  await page
    .getByRole("button", { name: "Close Flagged shots", exact: true })
    .click();
  const recordedWorkspace = await (
    await page.request.get(
      "/api/curlcoach/workspace?source=sample&eventId=practice",
    )
  ).json();
  const flagged = recordedWorkspace.event.games[0].state.events.findLast(
    (event: { shot?: { note?: string } }) =>
      event.shot?.note === "Review the line call",
  );
  expect(flagged.shot.videoReview.lookBackSeconds).toBe(45);
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await openEntryTab(page, "Execution");
  await page.getByLabel("Numeric grade").selectOption("4");
  await page.getByRole("button", { name: "Next Turn" }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Throwing position",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveValue("Second");
  await expect(
    page.getByRole("combobox", {
      name: "Player",
      exact: true,
      includeHidden: true,
    }),
  ).toHaveValue("second");
  await page.screenshot({
    path: `test-results/compact-scoring-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
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
