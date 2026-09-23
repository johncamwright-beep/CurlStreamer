import { expect, test } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

test("hidden scoring slows reads and returning to the page refreshes immediately", async ({
  page,
}) => {
  let reads = 0;
  const game = gameFixture();
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    reads++;
    await route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    });
  });
  await page.goto(`/score/${testGameId}`);
  await expect(page.getByText("Match score", { exact: true })).toBeVisible();
  await expect.poll(() => reads).toBeGreaterThan(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Allow a request already in flight when the tab is hidden to finish.
  await page.waitForTimeout(300);
  const hiddenReads = reads;
  await page.waitForTimeout(2200);
  expect(reads).toBe(hiddenReads);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => reads, { timeout: 1000 })
    .toBeGreaterThan(hiddenReads);
});
