import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const gameId = "11111111-1111-4111-8111-111111111111";
let browserBundle = "";

test.beforeAll(async () => {
  const result = await build({
    bundle: true,
    format: "iife",
    platform: "browser",
    write: false,
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `
        import React from "react";
        import { createRoot } from "react-dom/client";
        import { GameDeletionControl } from "./src/components/GameDeletionControl";
        (globalThis as any).React = React;
        const parameters = new URLSearchParams(location.search);
        const restore = parameters.get("mode") === "restore";
        createRoot(document.getElementById("root")!).render(
          <GameDeletionControl
            gameId="${gameId}"
            title="Browser deletion fixture"
            matchup="Home vs Away"
            restore={restore}
            cleanupStatus={restore ? "failed" : undefined}
            cleanupAttempts={restore ? 1 : undefined}
            cleanupLastError={restore ? "mock provider unavailable" : undefined}
          />,
        );
      `,
    },
    plugins: [
      {
        name: "next-navigation-browser-test",
        setup(esbuild) {
          esbuild.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "next/navigation",
            namespace: "browser-test",
          }));
          esbuild.onLoad({ filter: /.*/, namespace: "browser-test" }, () => ({
            loader: "js",
            contents: `
                export function useRouter() {
                  return {
                    refresh() {
                      window.__curlcastRefreshes =
                        (window.__curlcastRefreshes || 0) + 1;
                    },
                  };
                }
              `,
          }));
        },
      },
    ],
  });
  browserBundle = result.outputFiles[0].text;
});

test("committed deletion clears device state and cleanup remains retryable after reload", async ({
  page,
}) => {
  await page.route("**/__game_deletion_harness**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main id="root"></main>',
    }),
  );
  const requests: string[] = [];
  let deleteAttempts = 0;
  await page.route(`**/api/games/${gameId}/deletion`, async (route) => {
    requests.push(route.request().method());
    if (route.request().method() === "POST") {
      await route.fulfill({ json: { changed: true } });
      return;
    }
    deleteAttempts += 1;
    if (deleteAttempts === 1) {
      await route.fulfill({
        status: 202,
        json: {
          changed: true,
          deletionCommitted: true,
          warning: "Live video cleanup needs to be retried.",
          cleanup: {
            status: "failed",
            attempts: 1,
            lastError: "mock provider unavailable",
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        changed: false,
        deletionCommitted: true,
        cleanup: { status: "complete", attempts: 2, lastError: null },
      },
    });
  });

  await page.goto("/__game_deletion_harness?mode=delete");
  await page.addScriptTag({ content: browserBundle });
  await page.evaluate(
    ({ key, value }) => localStorage.setItem(key, JSON.stringify(value)),
    {
      key: "curlcast-current-game",
      value: {
        id: gameId,
        title: "Browser deletion fixture",
        scheduledLabel: "Today",
        capabilities: {
          control: true,
          scoring: true,
          broadcast: true,
          editSchedule: true,
          assignOpponent: false,
        },
      },
    },
  );
  await page.getByRole("button", { name: "Delete Game" }).click();
  await page.getByRole("button", { name: "Confirm Delete Game" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("curlcast-current-game")),
    )
    .toBeNull();

  await page.goto("/__game_deletion_harness?mode=restore");
  await page.addScriptTag({ content: browserBundle });
  await expect(page.getByText("Live video cleanup is failed")).toBeVisible();
  await page.getByRole("button", { name: "Retry video cleanup" }).click();
  await expect.poll(() => deleteAttempts).toBe(2);

  await page.getByRole("button", { name: "Restore Game" }).click();
  await page.getByRole("button", { name: "Confirm Restore Game" }).click();
  await expect.poll(() => requests).toEqual(["DELETE", "DELETE", "POST"]);
});

test("a retry network error resets the busy control", async ({ page }) => {
  await page.route("**/__game_deletion_harness**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<main id="root"></main>',
    }),
  );
  await page.route(`**/api/games/${gameId}/deletion`, (route) => route.abort());

  await page.goto("/__game_deletion_harness?mode=restore");
  await page.addScriptTag({ content: browserBundle });
  const retry = page.getByRole("button", { name: "Retry video cleanup" });
  await retry.click();
  await expect(page.getByRole("alert")).toContainText("Check your connection");
  await expect(retry).toBeEnabled();
});
