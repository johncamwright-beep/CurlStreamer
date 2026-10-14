import { weightLabels } from "../../src/lib/curlcoach/shot-subtypes";
import { expect, test, type Page } from "@playwright/test";

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
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Guard/Front Stone");
  await page
    .getByRole("combobox", { name: "Shot subtype", exact: true })
    .selectOption("guard");
  expect(
    await page
      .getByRole("combobox", { name: "Called weight", exact: true })
      .locator("option")
      .allTextContents(),
  ).toEqual(["Not recorded", "Guard 1", "Guard 2", "Guard 3"]);
  expect(
    await page
      .getByRole("combobox", { name: "Observed weight", exact: true })
      .locator("option")
      .allTextContents(),
  ).toEqual(["Not assessed", ...Object.values(weightLabels)]);
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
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Hit & Roll");
  await page
    .getByRole("combobox", { name: "Shot subtype", exact: true })
    .selectOption("hit_and_roll_under");
  await page
    .getByRole("combobox", { name: "Called weight", exact: true })
    .selectOption("control_weight_takeout");
  await page
    .getByRole("combobox", { name: "Shot difficulty", exact: true })
    .selectOption("demanding");
  await page
    .getByRole("combobox", { name: "Execution", exact: true })
    .selectOption("Make");
  await page
    .getByRole("combobox", { name: "Numeric grade", exact: true })
    .selectOption("5");
  await expect(
    page.getByRole("combobox", { name: "Result observations", exact: true }),
  ).toHaveValue("");
  await expect(
    page.getByRole("combobox", { name: "Observed weight", exact: true }),
  ).toHaveValue("");
  await page
    .getByRole("combobox", { name: "Observed weight", exact: true })
    .selectOption("button");
  await page
    .getByRole("combobox", { name: "Result observations", exact: true })
    .selectOption("roll_far");
  await page
    .getByRole("combobox", { name: "Add another miss", exact: true })
    .selectOption("jammed");
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
  await page.getByRole("button", { name: "Save attempt", exact: true }).click();
  await expect(
    page.locator(".coach-scoring [role=status]").first(),
  ).toContainText("Attempt saved");
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await page
    .locator(".coach-attempt")
    .filter({ hasText: `End ${end}` })
    .getByRole("button", { name: "Edit", exact: true })
    .click();
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
  ).toContainText("Team weighted shooting");
  await expect(page.getByLabel("Difficulty-adjusted shooting")).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Current shot context" }),
  ).toContainText("Team weighted shooting");
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
  await page
    .getByRole("combobox", { name: "Result observations", exact: true })
    .selectOption("");
  await page
    .getByRole("combobox", { name: "Observed weight", exact: true })
    .selectOption("");
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
  await expect(
    page.getByRole("combobox", { name: "Shot subtype", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Called weight", exact: true }),
  ).toBeVisible();
  expect(
    await page
      .getByRole("combobox", { name: "Called weight", exact: true })
      .locator("option")
      .allTextContents(),
  ).toContain("Guard 1");
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
  ).toContainText("Team weighted shooting");
  await expect(page.getByLabel("Difficulty-adjusted shooting")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Recorded shots", exact: true })
    .click();
  await attempt.getByRole("button", { name: "Edit", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Called weight", exact: true })
    .selectOption("hack");
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
  await expect(
    page.getByRole("combobox", { name: "Shot subtype", exact: true }),
  ).toHaveValue("hit_and_roll_under");
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
  await navigate(page, "Enhanced review");
  await page
    .getByRole("combobox", { name: "Review shot", exact: true })
    .selectOption(saved.shotId);
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
