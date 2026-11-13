import { expect, test } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

test("live broadcast coalesces refresh notifications while a game read is pending", async ({
  page,
}) => {
  await page.clock.install();
  let reads = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/games/" + testGameId + "*", async (route) => {
    reads++;
    if (reads === 2) await held;
    await route.fulfill({ json: gameFixture() });
  });
  await page.goto("/broadcast/" + testGameId);
  await expect.poll(() => reads).toBe(1);
  await page.clock.fastForward(2000);
  await expect.poll(() => reads).toBe(2);
  await page.clock.fastForward(6000);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++)
      document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(reads).toBe(2);
  release();
  await expect.poll(() => reads).toBe(3);
});

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
