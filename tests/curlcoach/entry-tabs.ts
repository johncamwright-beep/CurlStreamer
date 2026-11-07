import type { Page } from "@playwright/test";

/** Open the entry section before exercising its controls; other views have no tabs. */
export async function openEntryTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await page.locator(".coach-scoring").isVisible()) {
    await tab.waitFor({ state: "visible" });
    await tab.click();
  }
}
