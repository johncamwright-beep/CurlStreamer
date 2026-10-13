import { expect, test, type Page } from "@playwright/test";

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test.use({ actionTimeout: 10000 });

async function navigate(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();

  await page.getByRole("link", { name, exact: true }).click();
}

test("persistent coach mode, atomic capture, Standard correction and supplemental review", async ({
  page,
}, info) => {
  test.setTimeout(90000);

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

  await page.reload();

  await expect(page.getByLabel("Metrics mode")).toHaveValue("enhanced");

  await navigate(page, "Charting");

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

  const end = info.project.name === "phone" ? "17" : "18";

  await page.getByLabel("End", { exact: true }).fill(end);

  await page
    .getByRole("combobox", { name: "Stone", exact: true })
    .selectOption("1");

  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("");

  await page
    .getByLabel("Detailed shot", { exact: true })
    .selectOption("runback_double");

  await expect(
    page.getByRole("combobox", { name: "Shot type", exact: true }),
  ).toHaveValue("Runback/Multiple");

  await page
    .getByRole("combobox", { name: "Intended weight", exact: true })
    .selectOption("back_12");

  await page
    .getByLabel("Contact plan", { exact: true })
    .selectOption("direct_contact_with_target");

  await page.getByLabel("Guard to clear", { exact: true }).selectOption("yes");

  await page
    .getByText("Observed miss details · Not assessed", { exact: true })
    .click();

  await page.getByLabel("Flash wide", { exact: true }).check();
  await page.reload();
  // The anonymous synthetic lab has no account-scoped Standard resume store.
  // Return to the same slot; its Enhanced draft must still be retained.
  await page.getByLabel("End", { exact: true }).fill(end);
  await page
    .getByRole("combobox", { name: "Stone", exact: true })
    .selectOption("1");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Runback/Multiple");
  await expect(
    page.getByRole("combobox", { name: "Intended weight", exact: true }),
  ).toHaveValue("back_12");
  await expect(
    page.getByText("Observed miss details · Flash wide", { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "Execution", exact: true })
    .selectOption("Partial");

  await page
    .getByRole("combobox", { name: "Numeric grade", exact: true })
    .selectOption("2");

  await page.getByRole("button", { name: "Save attempt", exact: true }).click();

  await expect(page.locator(".coach-scoring [role=status]").first()).toHaveText(
    "Attempt saved. Report updated.",
  );

  const workspace = await (
    await page.request.get(
      "/api/curlcoach/workspace?source=sample&eventId=practice",
    )
  ).json();

  const game = workspace.event.games[0];

  const saved = game.state.events.find(
    (e: { shot: { end: number } }) => e.shot?.end === Number(end),
  );

  expect(saved).toBeTruthy();

  const url = `/api/curlcoach/enhanced?gameId=${game.id}&eventId=practice`;

  const before = await (await page.request.get(url)).json();

  expect(
    before.documents.find((d: { shotId: string }) => d.shotId === saved.shotId)
      .value.values.misses,
  ).toEqual(["flash_wide"]);

  await navigate(page, "Options");

  await page.getByLabel("Metrics mode").selectOption("standard");

  await page.getByRole("button", { name: "Save Options", exact: true }).click();

  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();

  await navigate(page, "Charting");

  await expect(page.getByLabel("Detailed shot", { exact: true })).toHaveCount(
    0,
  );

  const attempt = page
    .locator(".coach-attempt")
    .filter({ hasText: `End ${end}` })
    .first();

  await attempt.getByRole("button", { name: "Correct", exact: true }).click();

  await page.getByLabel("Numeric grade").selectOption("4");

  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();

  await expect(attempt).toContainText("4/5");

  const after = await (await page.request.get(url)).json();

  expect(after.documents).toEqual(before.documents);

  await navigate(page, "Options");

  await page.getByLabel("Metrics mode").selectOption("enhanced");

  await page.getByRole("button", { name: "Save Options", exact: true }).click();

  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();

  await navigate(page, "Enhanced review");

  await page
    .getByRole("combobox", { name: "Review shot", exact: true })
    .selectOption(saved.shotId);

  await expect(
    page.getByRole("combobox", { name: "Intended weight", exact: true }),
  ).toHaveValue("back_12");

  await page
    .getByRole("combobox", { name: "Intended weight", exact: true })
    .selectOption("control_weight_takeout");

  await page
    .getByRole("button", { name: "Save Enhanced review", exact: true })
    .click();

  await expect(
    page.getByText("Enhanced review saved. Standard scores are unchanged."),
  ).toBeVisible();

  await page.reload();

  await page
    .getByRole("combobox", { name: "Review shot", exact: true })
    .selectOption(saved.shotId);

  await expect(
    page.getByRole("combobox", { name: "Intended weight", exact: true }),
  ).toHaveValue("control_weight_takeout");

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);

  await page.screenshot({
    path: `test-results/enhanced-review-${info.project.name}.png`,
    fullPage: true,
  });

  await navigate(page, "Options");

  await page.getByLabel("Metrics mode").selectOption("standard");

  await page.getByRole("button", { name: "Save Options", exact: true }).click();

  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();
});
