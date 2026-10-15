import { expect, test } from "@playwright/test";
import { gameFixture, testGameId } from "../src/test/game-fixture";

test("rock colours can be corrected in an active game without changing scores", async ({
  page,
}) => {
  const game = gameFixture();
  const before = structuredClone(game.scoreEvents);
  const writes: unknown[] = [];
  await page.route(`**/api/games/${testGameId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const action = route.request().postDataJSON();
      writes.push(action);
      if (action.type === "rock-colours") {
        game.config.homeColor = action.homeColor;
        game.config.awayColor = action.awayColor;
      }
    }
    await route.fulfill({
      json: game,
      headers: {
        "x-curlcast-operator": "true",
        "x-curlcast-account-role": "owner",
      },
    });
  });
  await page.goto(`/score/${testGameId}`);
  await page.getByRole("button", { name: "Rock colours", exact: true }).click();
  await page
    .getByRole("radio", {
      name: game.config.homeName + " rocks: Yellow",
      exact: true,
    })
    .check();
  await page
    .getByRole("radio", {
      name: game.config.awayName + " rocks: Blue",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Save rock colours", exact: true })
    .click();
  await expect
    .poll(() => writes)
    .toEqual([
      { type: "rock-colours", homeColor: "#facc15", awayColor: "#2563eb" },
    ]);
  expect(game.scoreEvents).toEqual(before);
  await expect(
    page.getByRole("button", { name: "Rock colours", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
});
