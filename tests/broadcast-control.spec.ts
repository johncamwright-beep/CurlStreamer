import { expect, test } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

test("a browser operator keeps scoring and sponsors while streaming is handed to Windows Studio", async ({
  page,
}) => {
  let broadcastRequests = 0;
  const game = gameFixture();
  await page.route(`**/api/games/${testGameId}`, (route) =>
    route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    }),
  );
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) => {
    broadcastRequests += 1;
    return route.fulfill({ json: { status: "idle", desiredState: "stopped" } });
  });

  await page.goto(`/score/${testGameId}`);

  await expect(
    page.getByRole("heading", { name: "Requires Windows Studio" }),
  ).toBeVisible();
  await expect(
    page.getByText("same travel router", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Set up Windows Studio" }),
  ).toHaveAttribute("href", `/games/${testGameId}/studio`);
  await expect(
    page.getByRole("button", { name: "Start broadcast" }),
  ).toHaveCount(0);
  expect(broadcastRequests).toBe(0);
  await expect(
    page.getByRole("button", { name: /^(Start|Stop) sponsors$/ }),
  ).toBeVisible();
});
