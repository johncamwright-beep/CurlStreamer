import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

const gameId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const closing = {
  sessionId: "33333333-3333-4333-8333-333333333333",
  generation: 3,
  intentId: "44444444-4444-4444-8444-444444444444",
  capability: "final-card-v1",
};
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
  outcome: "saved" | "conflict" | "lost" | "malformed",
  capable = true,
) {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {EndGameControl} from './src/components/EndGameControl';window.order=[];window.pending={};window.chrome={webview:{postMessage(v){window.order.push(v.type);window.pending[v.type]=v; if(v.type==='studio-ending-prepare'||v.type==='studio-ending-cancel')window.dispatchEvent(new CustomEvent('studio-presentation-result',{detail:{gameId:v.gameId,nonce:v.nonce,ok:true,closing:${JSON.stringify(closing)},error:null}}));}}};window.addEventListener('curlcast:game-completed',()=>window.order.push('announced'));createRoot(document.getElementById('root')).render(<EndGameControl gameId="${gameId}" homeName="Team Benning" awayName="Away" enabled onCompleted={()=>window.order.push('completed')}/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/ending-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/ending-fixture.js"></script>',
    }),
  );
  await page.route("**/ending-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  const requests: Record<string, unknown>[] = [];
  await page.route(`**/api/games/${gameId}/completion`, async (r) => {
    const body = r.request().postDataJSON();
    requests.push(body);
    await page.evaluate(
      (action) => (window as unknown as { order: string[] }).order.push(action),
      body.action,
    );
    if (body.action === "review")
      return r.fulfill({
        json: {
          reviewId,
          result: completion.result,
          inputRevision: 4,
          youtubeWatchUrl: null,
        },
      });
    if (body.action === "retry-cleanup")
      return r.fulfill({
        json: { status: "complete", attempts: 1, lastError: null },
      });
    if (outcome === "conflict")
      return r.fulfill({
        status: 409,
        json: { error: "The score changed. Review the final score again." },
      });
    if (outcome === "lost") return r.abort("failed");
    if (outcome === "malformed") return r.fulfill({ json: {} });
    return r.fulfill({
      json: {
        completion,
        cleanup: { status: "pending", attempts: 0, lastError: null },
        closing: capable
          ? {
              sessionId: closing.sessionId,
              generation: closing.generation,
              intentId: closing.intentId,
              deadlineAt: new Date(Date.now() + 15000).toISOString(),
            }
          : null,
      },
    });
  });
  await page.goto("/ending-fixture");
  if (capable)
    await page.evaluate(
      (gameId) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", {
            detail: { gameId, available: true, canGracefulEnd: true },
          }),
        ),
      gameId,
    );
  await page.getByRole("button", { name: "End Game", exact: true }).click();
  await page
    .getByRole("button", { name: "Review final score", exact: true })
    .click();
  await expect(page.getByText("Team Benning 6 – 4 Away")).toBeVisible();
  await page
    .getByRole("button", { name: "Confirm End Game", exact: true })
    .click();
  return requests;
}
async function order(page: Page) {
  return page.evaluate(() => (window as unknown as { order: string[] }).order);
}
async function acknowledge(page: Page, type: string) {
  await page.evaluate((type) => {
    const message = (
      window as unknown as {
        pending: Record<string, { gameId: string; nonce: string }>;
      }
    ).pending[type];
    window.dispatchEvent(
      new CustomEvent("studio-presentation-result", {
        detail: {
          gameId: message.gameId,
          nonce: message.nonce,
          ok: true,
          error: null,
        },
      }),
    );
  }, type);
}
test("saved final score is painted before output Stop and provider cleanup", async ({
  page,
}) => {
  const requests = await fixture(page, "saved");
  await expect.poll(() => order(page)).toContain("studio-ending-show");
  expect(requests[1]).toEqual({ action: "complete", reviewId, closing });
  expect(await order(page)).toEqual([
    "review",
    "studio-ending-prepare",
    "complete",
    "announced",
    "studio-ending-show",
  ]);
  await expect(page.getByRole("button", { name: "Ending…" })).toBeDisabled();
  await acknowledge(page, "studio-ending-show");
  await expect.poll(() => order(page)).toContain("studio-ending-finish");
  expect(requests).toHaveLength(2);
  await acknowledge(page, "studio-ending-finish");
  await expect.poll(() => order(page)).toContain("completed");
  expect(await order(page)).toEqual([
    "review",
    "studio-ending-prepare",
    "complete",
    "announced",
    "studio-ending-show",
    "studio-ending-finish",
    "retry-cleanup",
    "completed",
  ]);
});
test("conflicting completion cancels preparation and never shows a final card", async ({
  page,
}) => {
  await fixture(page, "conflict");
  await expect(page.getByRole("alert")).toContainText(
    "Review the final score again",
  );
  expect(await order(page)).toEqual([
    "review",
    "studio-ending-prepare",
    "complete",
    "studio-ending-cancel",
  ]);
});
for (const outcome of ["lost", "malformed"] as const)
  test(`${outcome} completion response stops safely rather than resuming live video`, async ({
    page,
  }) => {
    await fixture(page, outcome);
    await expect.poll(() => order(page)).toContain("studio-ending-finish");
    await acknowledge(page, "studio-ending-finish");
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await order(page)).not.toContain("studio-ending-cancel");
    expect(await order(page)).not.toContain("studio-ending-show");
  });
test("older Studio completes immediately without new native commands", async ({
  page,
}) => {
  const requests = await fixture(page, "saved", false);
  await expect.poll(() => order(page)).toContain("completed");
  expect(requests[1]).toEqual({ action: "complete", reviewId });
  expect(await order(page)).toEqual([
    "review",
    "complete",
    "announced",
    "completed",
  ]);
});
