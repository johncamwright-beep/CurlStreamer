import { test, expect } from "@playwright/test";
import { build } from "esbuild";
test("phone handoff confirms the recorded shot and audience before saving", async ({
  page,
}) => {
  const gameId = "11111111-1111-4111-8111-111111111111",
    shotId = "22222222-2222-4222-8222-222222222222";
  const review = {
    version: 1,
    id: "33333333-3333-4333-8333-333333333333",
    gameId,
    audience: "team",
    notes: "Discuss sweep call",
    selectedAt: "2026-11-09T20:00:10Z",
    capturedAt: "2026-11-09T20:01:00Z",
    timingEstimated: true,
  };
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Review from './src/app/shot-tracker/review-import/page';createRoot(document.getElementById('root')).render(<Review/>);`,
    },
  });
  await page.route("**/coach-handoff-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  let saved: unknown = null;
  await page.route("**/api/curlcoach/local-review**", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: {
          revision: 3,
          shots: [
            {
              id: shotId,
              end: 2,
              stone: 1,
              position: "Lead",
              player: "Alex",
              note: "",
            },
          ],
        },
      });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto(
    "http://127.0.0.1:3189/coach-handoff-fixture#" +
      encodeURIComponent(JSON.stringify(review)),
  );
  await expect(
    page.getByRole("button", { name: "Save flag", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Recorded shot").selectOption(shotId);
  await page.getByRole("button", { name: "Save flag", exact: true }).click();
  await expect(page.getByText(/Flag saved for the team/)).toBeVisible();
  expect(saved).toEqual({ review, shotId, expectedRevision: 3 });
  expect(new URL(page.url()).hash).toBe("");
});
