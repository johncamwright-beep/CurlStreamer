// Browser integration with explicit local API fixtures; no hosted game is created.
import { expect, type Page } from "@playwright/test";
import { broadcastGame } from "../../src/lib/game-projection";
import { applyScoringAction } from "../../src/lib/scoring";
import { gameFixture, testGameId } from "../../src/test/game-fixture";

export const fixtureOrganizer = `fixture.${Buffer.from(JSON.stringify({ purpose: "organizer", gameId: testGameId })).toString("base64url")}.fixture`;

export async function installGameFixture(page: Page, operator = true) {
  const game = gameFixture();
  game.scoreEvents = [];
  game.claims = {};
  game.sponsors = game.sponsors.slice(0, 1);
  game.sponsorMode.rotationOffset = 0;
  game.sponsorMode.active = false;
  const headers: Record<string, string> = operator
    ? { "x-curlcast-operator": "true", "x-curlcast-account-role": "owner" }
    : {};
  await page.route(`**/api/games/${testGameId}*`, async (route) => {
    if (route.request().method() === "PATCH") {
      expect(operator).toBe(true);
      const action = route.request().postDataJSON();
      if (action.type === "sponsor-mode") {
        expect(action).toEqual({ type: "sponsor-mode", active: true });
        game.sponsorMode.active = true;
        game.sponsorMode.startedAt = Date.now();
      } else applyScoringAction(game, action);
    }
    const publicView =
      new URL(route.request().url()).searchParams.get("view") === "broadcast";
    await route.fulfill({
      json: publicView ? broadcastGame(game) : game,
      headers,
    });
  });
  await page.route(`**/api/games/${testGameId}/livekit-token*`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "Synthetic fixture has no media provider" },
    }),
  );
  await page.route(`**/api/games/${testGameId}/invitations`, (route) => {
    const role = route.request().postDataJSON().role;
    return route.fulfill({
      json: {
        url: new URL(
          `/join/${testGameId}?fixture=${role}`,
          route.request().url(),
        ).href,
        expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    });
  });
  await page.route(`**/api/games/${testGameId}/broadcast`, (route) =>
    route.fulfill({
      json: { phase: "idle", desiredState: "stopped", canManage: operator },
    }),
  );
  return game;
}
