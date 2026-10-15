import { expect, test } from "@playwright/test";
import { installGameFixture } from "./support/game-browser-fixture";
import { testGameId } from "../src/test/game-fixture";

test("zoom controls fit beside desktop preview and below narrow preview", async ({
  page,
}, testInfo) => {
  const game = await installGameFixture(page);
  game.cameraZoom = {
    "camera-home": {
      supported: true,
      min: 1,
      max: 4,
      step: 0.1,
      value: 1,
      updatedAt: Date.now(),
    },
    "camera-away": { supported: false, updatedAt: Date.now() },
  };
  await page.goto(`/broadcast/${testGameId}`);
  const rail = page.getByTestId("camera-zoom-rail");
  await expect(rail).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Camera 1 zoom in" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Camera 2 zoom in" }),
  ).toBeDisabled();
  const railBox = (await rail.boundingBox())!;
  const preview = (await page
    .getByTestId("broadcast-visible-wrapper")
    .boundingBox())!;
  const width = await page.evaluate(() => window.innerWidth);
  expect(preview.x + preview.width).toBeLessThanOrEqual(width + 1);
  if (width > 700)
    expect(preview.x).toBeGreaterThanOrEqual(railBox.x + railBox.width);
  else expect(preview.y + preview.height).toBeLessThanOrEqual(railBox.y);
  await page.screenshot({ path: testInfo.outputPath("zoom-layout.png") });
});
