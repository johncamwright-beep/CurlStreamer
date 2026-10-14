import { openEntryTab } from "./entry-tabs";
import { expect, test } from "@playwright/test";

// Shared tabbed entry regression coverage; phone and desktop layout is exercised in mobile-entry.spec.ts.
test.use({ viewport: { width: 820, height: 1180 } });

test.skip(!process.env.CURLCOACH_E2E, "Use the Shot Tracker config");

test("entry overlays preserve draft, keep the page stable and restore focus", async ({
  page,
}, info) => {
  test.setTimeout(60000);
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
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Shot type", exact: true })
    .selectOption("Draw");
  await openEntryTab(page, "Shot");
  await page
    .getByRole("combobox", { name: "Called weight", exact: true })
    .selectOption("button");
  const trigger = page.getByRole("button", {
    name: "Change",
    exact: true,
  });
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await trigger.click();
  const dialog = page.getByRole("dialog", {
    name: "Change",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await page
    .getByRole("combobox", { name: "Throwing position", exact: true })
    .selectOption("Second");
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(
    height,
  );
  await page.screenshot({
    path: `work/tracker-overlay-${info.project.name}.png`,
  });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(
    page.getByRole("combobox", { name: "Throwing position", exact: true }),
  ).toHaveValue("Second");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await openEntryTab(page, "Shot");
  await expect(
    page.getByRole("combobox", { name: "Shot type", exact: true }),
  ).toHaveValue("Draw");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await openEntryTab(page, "Notes");
  await page
    .getByLabel("Private coaching note")
    .fill("Synthetic overlay draft");
  await openEntryTab(page, "Shot");
  await page.getByRole("tab", { name: "Notes", exact: true }).click();
  await openEntryTab(page, "Notes");
  await expect(page.getByLabel("Private coaching note")).toHaveValue(
    "Synthetic overlay draft",
  );
  await openEntryTab(page, "Shot");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `work/tracker-entry-${info.project.name}.png`,
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(
    page.getByRole("navigation", { name: "Shot Tracker shortcuts" }),
  ).toBeVisible();
  await page.screenshot({
    path: `work/tracker-entry-desktop-${info.project.name}.png`,
    fullPage: false,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  // Restore the shared synthetic lab setting for later Standard workflow tests.
  await page.goto("/curlcoach?event=practice#options");
  await page.getByLabel("Metrics mode").selectOption("standard");
  await page.getByRole("button", { name: "Save Options", exact: true }).click();
  await expect(
    page.getByText("Options saved for your coaching account."),
  ).toBeVisible();
});
