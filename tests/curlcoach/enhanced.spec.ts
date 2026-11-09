import { openEntryTab } from "./entry-tabs";
import { chooseWeight, openWeight, weightField } from "./weight-roller";
import { weightLabels } from "../../src/lib/curlcoach/shot-subtypes";
import { expect, test, type Page } from "@playwright/test";

// Shared tabbed entry regression coverage; phone and desktop layout is exercised in mobile-entry.spec.ts.
test.use({ viewport: { width: 820, height: 1180 } });

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");
test.use({ actionTimeout: 10000 });
async function navigate(page: Page, name: string) {
  await page
    .getByRole("button", { name: "Shot Tracker menu", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name, exact: true })
    .click();
}
async function mode(page: Page, value: string) {
  await page.goto("/curlcoach?event=practice#options");
  await expect(
    page.getByRole("button", { name: "Save Options", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Metrics mode").selectOption(value);
  await page.getByRole("button", { name: "Save Options", exact: true }).click();
  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();
  await navigate(page, "Charting");
}

test("workbook selections, corrections, clearing, Standard mode and historical preservation", async ({
  page,
}, info) => {
  test.setTimeout(120000);
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
  await expect(
    page.getByRole("button", { name: "Change", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("End", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "Change", exact: true }).click();
  const end = info.project.name === "phone" ? "17" : "18";
  await page.getByLabel("End", { exact: true }).fill(end);
  await page
    .getByRole("combobox", { name: "Stone", exact: true })
    .selectOption("1");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText(`End ${end}`);
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Guard/Front Stone");
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot subtype", exact: true })
    .selectOption("guard");
  const called = await openWeight(page, "Called weight");
  await expect(called.wheel.getByRole("option")).toHaveText(
    Object.values(weightLabels),
  );
  await called.wheel.press("Escape");
  await chooseWeight(page, "Called weight", "board");
  await openEntryTab(page, "Execution");
  const observed = await openWeight(page, "Observed weight");
  await expect(
    observed.wheel.getByRole("option", { selected: true }),
  ).toHaveText("Board");
  await observed.wheel.press("Escape");
  expect(
    await page
      .getByRole("combobox", { name: "Result observations", exact: true })
      .locator("option")
      .allTextContents(),
  ).toEqual([
    "Not assessed",
    "No observed miss",
    "Light",
    "Heavy",
    "Hog",
    "In-House",
  ]);
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Hit & Roll");
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot subtype", exact: true })
    .selectOption("hit_and_roll_under");
  await openEntryTab(page, "Shot");
  await chooseWeight(page, "Called weight", "control_weight_takeout");
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot difficulty", exact: true })
    .selectOption("demanding");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Execution", exact: true })
    .selectOption("Make");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Numeric grade", exact: true })
    .selectOption("5");
  await openEntryTab(page, "Execution");
  await expect(
    page.getByRole("combobox", { name: "Result observations", exact: true }),
  ).toHaveValue("");
  await openEntryTab(page, "Execution");
  await expect(weightField(page, "Observed weight")).toHaveText(
    "Control (called)",
  );
  await chooseWeight(page, "Observed weight", "button");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Result observations", exact: true })
    .selectOption("roll_far");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Add another miss", exact: true })
    .selectOption("jammed");
  await openEntryTab(page, "Technical");
  await page
    .getByRole("combobox", { name: "Line", exact: true })
    .selectOption("Wide");
  await expect(
    page.getByRole("button", { name: "Optional call details", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Guard to clear", exact: true }),
  ).toBeHidden();
  // Save first: historical details are available only during correction.
  let observationReloads = 0;
  const countReloads = (request: import("@playwright/test").Request) => {
    if (
      request.method() === "GET" &&
      request.url().includes("/api/curlcoach/enhanced?gameId=")
    )
      observationReloads++;
  };
  page.on("request", countReloads);
  await page.getByRole("button", { name: "Next Turn", exact: true }).click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("Saved.");
  expect(observationReloads).toBe(0);
  page.off("request", countReloads);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await page
    .locator(".coach-attempt")
    .filter({ hasText: `End ${end}` })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
  await openEntryTab(page, "Notes");
  // Set historical details explicitly, then ensure ordinary corrections retain them.
  await page
    .getByRole("button", { name: /^Saved observation details/ })
    .click();
  await page
    .getByText("Historical call and observations", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Guard to clear", exact: true })
    .selectOption("yes");
  await page
    .getByText("Weight basis and historical result details", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Available tolerance", exact: true })
    .selectOption("tight");
  await page
    .getByRole("combobox", { name: "Tolerance result", exact: true })
    .selectOption("outside_called_tolerance");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Done", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(page.locator(".coach-scoring [role=status]").first()).toHaveText(
    "Attempt saved. Report updated.",
  );
  const workspace = await (
    await page.request.get(
      "/api/curlcoach/workspace?source=sample&eventId=practice",
    )
  ).json();
  const game = workspace.event.games[0];
  const saved = game.state.events.findLast(
    (e: { shot?: { end: number } }) => e.shot?.end === Number(end),
  );
  expect(saved.shot.type).toBe("Hit & Roll");
  const difficultyWorkspace = await (
    await page.request.get(
      "/api/curlcoach/workspace?source=sample&eventId=practice&includeDifficulty=true",
    )
  ).json();
  expect(difficultyWorkspace.event.games[0].difficultyReady).toBe(true);
  expect(
    difficultyWorkspace.event.games[0].difficultyRecords.find(
      (r: { shotId: string }) => r.shotId === saved.shotId,
    ).level,
  ).toBe("B");
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText("Team (W)");
  await expect(page.getByLabel("Difficulty-adjusted shooting")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText("Team (W)");
  await expect(page.getByLabel("Difficulty-adjusted shooting")).toHaveCount(0);
  const url = `/api/curlcoach/enhanced?gameId=${game.id}&eventId=practice`;
  const read = async () =>
    (await (await page.request.get(url)).json()).documents.find(
      (d: { shotId: string }) => d.shotId === saved.shotId,
    ).value;
  expect((await read()).values).toMatchObject({
    shotSubtype: "hit_and_roll_under",
    resultObservations: ["roll_far", "jammed"],
    observedDestination: "button",
    guardToClear: "yes",
    tolerance: "tight",
  });
  const attempt = page
    .locator(".coach-attempt")
    .filter({ hasText: `End ${end}` })
    .first();
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Result observations", exact: true })
    .selectOption("");
  await openEntryTab(page, "Execution");
  await chooseWeight(page, "Observed weight", "");
  await expect(weightField(page, "Observed weight")).toHaveText("Not assessed");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("saved");
  const cleared = await read();
  expect(cleared.values.resultObservations).toBeUndefined();
  expect(cleared.assessments.results).toBe("not_assessed");
  expect(cleared.assessments.destination).toBe("not_assessed");
  expect(cleared.values).toMatchObject({
    guardToClear: "yes",
    toleranceResult: "outside_called_tolerance",
  });
  await mode(page, "standard");
  await openEntryTab(page, "Shot");
  await expect(
    page.getByRole("combobox", { name: "Shot subtype", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Shot");
  const standard = await openWeight(page, "Called weight");
  await expect(standard.wheel.getByRole("option")).toHaveText(
    Object.values(weightLabels),
  );
  await standard.wheel.press("Escape");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Numeric grade", exact: true })
    .selectOption("4");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(attempt).toContainText("4/5");
  expect((await read()).values).toEqual(cleared.values);
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText("Team (W)");
  await expect(page.getByLabel("Difficulty-adjusted shooting")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Shot");
  await chooseWeight(page, "Called weight", "hack");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("saved");
  expect((await read()).values.intendedWeight).toBe("hack");
  await mode(page, "enhanced");
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await openEntryTab(page, "Shot");
  await expect(
    page.getByRole("combobox", { name: "Shot subtype", exact: true }),
  ).toHaveValue("hit_and_roll_under");
  await openEntryTab(page, "Execution");
  await page
    .getByRole("combobox", { name: "Result observations", exact: true })
    .selectOption("none");
  await page
    .getByRole("button", { name: "Save correction", exact: true })
    .click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("saved");
  expect((await read()).values.resultObservations).toEqual([]);
  await navigate(page, "Analysis");
  await page
    .getByRole("tab", { name: "Advanced Analysis", exact: true })
    .click();
  await page
    .getByRole("link", { name: "Enhanced review", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Review shot", exact: true })
    .selectOption(saved.shotId);
  await openEntryTab(page, "Execution");
  await expect(
    page.getByRole("combobox", { name: "Result observations", exact: true }),
  ).toHaveValue("none");
  await page.getByText("Saved observation details", { exact: true }).click();
  await expect(
    page.locator("dd").getByText("Outside called tolerance", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: `work/subtype-review-${info.project.name}.png`,
    fullPage: true,
  });
  await mode(page, "standard");
});
