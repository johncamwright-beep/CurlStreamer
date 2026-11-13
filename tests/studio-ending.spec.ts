import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

const gameId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const completion = {
  status: "completed",
  eventName: "Final",
  homeName: "Team Benning",
  awayName: "Away",
  result: {
    outcome: "home_win",
    label: "Home win",
    totals: { home: 6, away: 4 },
    ends: [],
  },
  youtubeWatchUrl: null,
  completedAt: "2026-10-05T17:00:00Z",
};

async function fixture(
  page: Page,
  outcome: "saved" | "conflict" | "denied" | "lost" | "malformed",
  sender: "active" | "stopped" | "disconnected" | "absent" = "active",
  holdAcknowledgement = false,
) {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {EndGameControl} from './src/components/EndGameControl';
        import {StudioSessionContext} from './src/components/StudioSessionContext';
        const gameId = "${gameId}";
        const sender = "${sender}";
        const session = { gameId, active: true, busy: false, outputActive: sender === 'active', canLeaveGame: true };
        window.order = [];
        if (sender !== 'absent') window.chrome = {webview: {postMessage(v) {
          window.order.push(v.type);
          if (v.type === 'studio-game-ended' && !${holdAcknowledgement})
            window.dispatchEvent(new CustomEvent('studio-game-ended-ack', { detail: { gameId } }));
        }}};
        window.addEventListener('curlcast:game-completed', () => window.order.push('announced'));
        createRoot(document.getElementById('root')).render(
          <StudioSessionContext.Provider value={sender === 'absent' ? null : session}>
            <EndGameControl gameId={gameId} enabled onCompleted={() => window.order.push('completed')}/>
          </StudioSessionContext.Provider>
        );
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/ending-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/ending-fixture.js"></script>',
    }),
  );
  await page.route("**/ending-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  const requests: Record<string, unknown>[] = [];
  await page.route(`**/api/games/${gameId}/completion`, async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    await page.evaluate(
      (action) => (window as unknown as { order: string[] }).order.push(action),
      body.action,
    );
    if (body.action === "review")
      return route.fulfill({
        json: {
          reviewId,
          result: completion.result,
          inputRevision: 4,
          youtubeWatchUrl: null,
        },
      });
    if (outcome === "conflict")
      return route.fulfill({
        status: 409,
        json: { error: "The score changed. Review the final score again." },
      });
    if (outcome === "denied")
      return route.fulfill({
        status: 403,
        json: { error: "End Game administrator access is required" },
      });
    if (outcome === "lost") return route.abort("failed");
    if (outcome === "malformed") return route.fulfill({ json: {} });
    return route.fulfill({
      json: {
        completion,
        cleanup: { status: "complete", attempts: 1, lastError: null },
      },
    });
  });
  await page.goto("/ending-fixture");
  return requests;
}

async function reviewScore(page: Page) {
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  const prompt = page.getByRole("dialog", { name: "Is this game completed?" });
  await prompt.getByRole("button", { name: "Yes", exact: true }).click();
  const confirmation = page.getByRole("dialog", {
    name: "Finalize game score 6–4?",
  });
  await expect(confirmation.getByRole("button")).toHaveCount(2);
  return confirmation;
}

async function confirmScore(page: Page) {
  const confirmation = await reviewScore(page);
  await confirmation.getByRole("button", { name: "Yes", exact: true }).click();
}

async function order(page: Page) {
  return page.evaluate(() => (window as unknown as { order: string[] }).order);
}

test("commits the reviewed score directly and waits for Studio acknowledgement before leaving", async ({
  page,
}) => {
  await page.clock.install();
  const requests = await fixture(page, "saved", "active", true);
  await confirmScore(page);
  await expect
    .poll(() => order(page))
    .toEqual(["review", "complete", "announced", "studio-game-ended"]);
  await expect(page.getByRole("status")).toHaveText("Ending game…");
  expect(requests).toEqual([
    { action: "review", youtubeWatchUrl: "", finalScore: "scoreboard" },
    { action: "complete", reviewId },
  ]);
  await page.evaluate((gameId) => {
    window.dispatchEvent(
      new CustomEvent("studio-game-ended-ack", { detail: { gameId } }),
    );
  }, gameId);
  await expect.poll(() => order(page)).toContain("completed");
});

test("No at the final score returns to scoring and starts over next time", async ({
  page,
}) => {
  const requests = await fixture(page, "saved");
  const confirmation = await reviewScore(page);
  await confirmation.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Is this game completed?" }),
  ).toBeVisible();
  expect(requests.map(({ action }) => action)).toEqual(["review"]);
});

test("a stale score requires a fresh review and a new confirmation", async ({
  page,
}) => {
  await fixture(page, "conflict");
  await confirmScore(page);
  await expect(page.getByRole("alert")).toContainText(
    "Review the final score again",
  );
  await page.getByRole("button", { name: "Reload final score" }).click();
  await expect(
    page.getByRole("dialog", { name: "Finalize game score 6–4?" }),
  ).toBeVisible();
  expect(await order(page)).toEqual(["review", "complete", "review"]);
});

test("authorization failure keeps the reviewed score and game open", async ({
  page,
}) => {
  await fixture(page, "denied");
  await confirmScore(page);
  await expect(page.getByRole("alert")).toContainText(
    "administrator access is required",
  );
  await expect(
    page.getByRole("dialog", { name: "Finalize game score 6–4?" }),
  ).toBeVisible();
  expect(await order(page)).toEqual(["review", "complete"]);
});

for (const outcome of ["lost", "malformed"] as const)
  test(`${outcome} completion response offers reload without claiming the game ended`, async ({
    page,
  }) => {
    await fixture(page, outcome);
    await confirmScore(page);
    await expect(page.getByRole("alert")).toContainText(
      "could not be confirmed",
    );
    await expect(
      page.getByRole("button", { name: "Reload game" }),
    ).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Yes", exact: true }),
    ).toHaveCount(0);
    expect(await order(page)).toEqual(["review", "complete"]);
  });

for (const sender of ["stopped", "disconnected", "absent"] as const)
  test(`Close Game completes directly when the sender is ${sender}`, async ({
    page,
  }) => {
    const requests = await fixture(page, "saved", sender);
    await confirmScore(page);
    await expect.poll(() => order(page)).toContain("completed");
    expect(requests[1]).toEqual({ action: "complete", reviewId });
    expect(await order(page)).toEqual([
      "review",
      "complete",
      "announced",
      ...(sender === "absent" ? [] : ["studio-game-ended"]),
      "completed",
    ]);
  });
