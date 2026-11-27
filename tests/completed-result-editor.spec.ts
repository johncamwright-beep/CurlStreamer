import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import type { CompletedResultCorrection } from "../src/lib/completed-result";

const snapshot = {
  revision: 2,
  completion: {
    status: "completed",
    eventName: "Club night",
    homeName: "Birch",
    awayName: "Maple",
    completedAt: "2026-10-05T12:00:00Z",
    youtubeWatchUrl: null,
    result: {
      outcome: "away_win",
      label: "Away win",
      totals: { home: 2, away: 3 },
      ends: [
        { end: 1, team: "home", points: 2, blank: false },
        { end: 2, team: "away", points: 3, blank: false },
      ],
    },
  },
};
let fixtureBundle: string;
test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    write: false,
    outfile: "completed-result-fixture.js",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    plugins: [
      {
        name: "result-navigation-fixture",
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: "navigation",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: "export const useRouter=()=>({refresh(){}});",
            loader: "js",
          }));
        },
      },
    ],
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CompletedResultEditor}from'./src/components/CompletedResultEditor';createRoot(document.getElementById('root')).render(<CompletedResultEditor gameId="fixture" initialSnapshot={${JSON.stringify(snapshot)}}/>);`,
    },
  });
  fixtureBundle = bundle.outputFiles[0].text;
});

async function openEditor(page: Page) {
  await page.route("**/completed-result-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/completed-result-fixture.js"></script>',
    }),
  );
  await page.route("**/completed-result-fixture.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: fixtureBundle }),
  );
  await page.goto("/completed-result-fixture");
  await page.getByLabel("End 1 points").selectOption("5");
  await page
    .getByLabel("Reason for correction")
    .fill("End 1 was entered incorrectly");
}

function confirmed(correction: CompletedResultCorrection) {
  const totals = correction.ends.reduce(
    (sum, end) => {
      if (end.team) sum[end.team] += end.points;
      return sum;
    },
    { home: 0, away: 0 },
  );
  return {
    revision: correction.expectedRevision + 1,
    completion: {
      ...snapshot.completion,
      result: {
        outcome: "home_win",
        label: "Home win",
        totals,
        ends: correction.ends,
      },
    },
  };
}

test("an uncertain result save locks the draft and retries the identical correction before confirming success", async ({
  page,
}) => {
  const requests: CompletedResultCorrection[] = [];
  await page.route("**/api/games/fixture/result", async (route) => {
    const correction = route
      .request()
      .postDataJSON() as CompletedResultCorrection;
    requests.push(correction);
    if (requests.length === 1) await route.abort("failed");
    else await route.fulfill({ json: confirmed(correction) });
  });
  await openEditor(page);
  await page.getByRole("button", { name: "Save corrected result" }).click();
  const retry = page.getByRole("button", { name: "Retry same correction" });
  await expect(retry).toBeEnabled();
  await expect(page.getByLabel("End 1 points")).toBeDisabled();
  await expect(page.getByLabel("End 1 scoring team")).toBeDisabled();
  await expect(page.getByLabel("Reason for correction")).toBeDisabled();
  await expect(page.getByLabel("Reason for correction")).toHaveValue(
    "End 1 was entered incorrectly",
  );
  await expect(page.getByLabel("Saved final result")).toContainText(
    "Birch 2 – 3 Maple",
  );
  await expect(page.getByRole("status")).toHaveCount(0);
  await retry.click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0]).toMatchObject({
    expectedRevision: 2,
    reason: "End 1 was entered incorrectly",
    ends: [
      { end: 1, team: "home", points: 5, blank: false },
      { end: 2, team: "away", points: 3, blank: false },
    ],
  });
  expect(requests[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByLabel("Saved final result")).toContainText(
    "Birch 5 – 3 Maple",
  );
  await expect(page.getByLabel("End 1 points")).toBeEnabled();
  await expect(page.getByLabel("Reason for correction")).toHaveValue("");
});

test("a result conflict keeps the draft and requires explicit reload before saving against the latest revision", async ({
  page,
}) => {
  const requests: CompletedResultCorrection[] = [];
  let reads = 0;
  await page.route("**/api/games/fixture/result", async (route) => {
    if (route.request().method() === "GET") {
      reads++;
      await route.fulfill({
        json: confirmed({
          requestId: "10000000-0000-4000-8000-000000000001",
          expectedRevision: 6,
          reason: "Other correction",
          ends: [
            { end: 1, team: "home", points: 4, blank: false },
            { end: 2, team: "away", points: 3, blank: false },
          ],
        }),
      });
      return;
    }
    const correction = route
      .request()
      .postDataJSON() as CompletedResultCorrection;
    requests.push(correction);
    if (requests.length === 1)
      await route.fulfill({
        status: 409,
        json: { error: "Result changed", code: "result_conflict" },
      });
    else await route.fulfill({ json: confirmed(correction) });
  });
  await openEditor(page);
  const save = page.getByRole("button", { name: "Save corrected result" });
  await save.click();
  await expect(page.getByRole("alert")).toContainText(
    "Your draft has been kept",
  );
  await expect(save).toBeDisabled();
  await expect(page.getByLabel("End 1 points")).toHaveValue("5");
  await expect(page.getByLabel("Reason for correction")).toHaveValue(
    "End 1 was entered incorrectly",
  );
  expect(reads).toBe(0);
  expect(requests).toHaveLength(1);
  await page
    .getByRole("button", { name: "Reload latest saved result" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Your draft has been kept",
  );
  await expect(page.getByLabel("Saved final result")).toContainText(
    "Birch 4 – 3 Maple",
  );
  await expect(page.getByLabel("End 1 points")).toHaveValue("5");
  await expect(page.getByLabel("Reason for correction")).toHaveValue(
    "End 1 was entered incorrectly",
  );
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByRole("status")).toContainText("Correction saved");
  expect(reads).toBe(1);
  expect(requests).toHaveLength(2);
  expect(requests[0].expectedRevision).toBe(2);
  expect(requests[1].expectedRevision).toBe(7);
  expect(requests[1].requestId).not.toBe(requests[0].requestId);
  expect(requests[1].ends).toEqual(requests[0].ends);
  expect(requests[1].reason).toBe(requests[0].reason);
  await expect(page.getByLabel("Saved final result")).toContainText(
    "Birch 5 – 3 Maple",
  );
});
