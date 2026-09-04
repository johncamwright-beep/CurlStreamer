import { expect, test } from "@playwright/test";
import { broadcastGame, joinGame } from "../src/lib/game-projection";
import { gameFixture, testGameId } from "../src/test/game-fixture";

test("anonymous Broadcast requests the public view and removes the program on denial", async ({
  page,
}) => {
  let closed = false;
  let credentialRequests = 0;
  await page.route(
    `**/api/games/${testGameId}?view=broadcast`,
    async (route) => {
      expect(route.request().headers().authorization).toBeUndefined();
      await route.fulfill({
        status: closed ? 410 : 200,
        headers: { "cache-control": "no-store" },
        json: closed
          ? { error: "This game is closed" }
          : broadcastGame(gameFixture()),
      });
    },
  );
  await page.route(
    `**/api/games/${testGameId}/livekit-token?view=broadcast`,
    async (route) => {
      credentialRequests += 1;
      expect(route.request().method()).toBe("POST");
      expect(route.request().headers().authorization).toBeUndefined();
      await route.fulfill({
        headers: { "cache-control": "no-store" },
        json: {
          url: "wss://live.example.invalid",
          token: "subscriber-only-viewer-token",
        },
      });
    },
  );
  await page.goto(`/broadcast/${testGameId}`);
  await expect(page.getByTestId("broadcast-canvas")).toBeVisible();
  await expect.poll(() => credentialRequests).toBe(2);
  await expect(page.getByText("END 2")).toBeVisible();
  await expect(page.getByRole("img", { name: "Community" })).toBeVisible();
  await expect(page.getByTestId("back-to-scoring")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Scoring" })).toHaveCount(0);
  closed = true;
  await expect(page.locator("main[role='alert']")).toHaveText(
    "This game is closed",
  );
  await expect(page.getByTestId("broadcast-canvas")).toHaveCount(0);
});

test("the chooser sends its invitation and uses boolean role availability", async ({
  page,
}) => {
  const game = gameFixture();
  delete game.claims["camera-away"];
  await page.route(`**/api/games/${testGameId}?view=join`, async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer local-chooser-invitation",
    );
    await route.fulfill({
      json: joinGame(game),
      headers: { "cache-control": "no-store" },
    });
  });
  await page.route(`**/api/games/${testGameId}/invitations`, async (route) => {
    await route.fulfill({ json: { token: "local-role-invitation" } });
  });
  await page.goto(`/join/${testGameId}?chooser=local-chooser-invitation`);
  await expect(page.getByText("Club final")).toBeVisible();
  await expect(page.getByRole("button", { name: /Camera 1/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: /Camera 2/ })).toBeEnabled();
  await expect(
    page.getByRole("button", { name: /Scorekeeper/ }),
  ).toBeDisabled();
});
