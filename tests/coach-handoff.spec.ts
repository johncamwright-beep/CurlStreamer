import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

async function mountFixture(page: Page, pathname: string, contents: string) {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: { loader: "tsx", resolveDir: process.cwd(), contents },
  });
  await page.route(
    (url) => url.pathname === pathname,
    (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
      }),
  );
}

const importFixture = `import {createRoot} from 'react-dom/client';
import Review from './src/app/shot-tracker/review-import/page';
createRoot(document.getElementById('root')).render(<Review/>);`;

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
  await mountFixture(page, "/coach-handoff-fixture", importFixture);
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
  ).toBeEnabled();
  await page.getByLabel("Recorded shot").selectOption(shotId);
  await page.getByRole("button", { name: "Save flag", exact: true }).click();
  await expect(page.getByText(/Flag saved for the team/)).toBeVisible();
  expect(saved).toEqual({ review, shotId, expectedRevision: 3 });
  expect(new URL(page.url()).hash).toBe("");
  await expect(
    page.getByRole("link", { name: "View saved flags" }),
  ).toHaveAttribute(
    "href",
    `/shot-tracker?source=streamer&event=standalone&game=${gameId}#analysis/flagged`,
  );
});

test("empty games allow a standalone team flag and require a real player for player flags", async ({
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
  await mountFixture(page, "/coach-handoff-fixture", importFixture);
  let saved: unknown = null;
  let catalogUnavailable = true;
  await page.route("**/api/curlcoach/local-review**", (route) => {
    if (route.request().method() === "GET") {
      if (catalogUnavailable) {
        catalogUnavailable = false;
        return route.fulfill({
          status: 503,
          json: {
            error:
              "Could not load the game's event. Tap Reload shots to retry.",
          },
        });
      }
      return route.fulfill({
        json: {
          revision: 3,
          shots: [],
          players: [{ id: "lead", name: "Alex" }],
        },
      });
    }
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto(
    "http://127.0.0.1:3189/coach-handoff-fixture#" +
      encodeURIComponent(JSON.stringify(review)),
  );
  await expect(page.getByRole("alert")).toContainText(
    "Could not load the game's event",
  );
  await expect(page.getByRole("button", { name: "Save flag" })).toBeDisabled();
  await page.getByRole("button", { name: "Reload shots" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue(review.notes);
  await expect(
    page.getByRole("button", { name: "Save flag", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Review for").selectOption("player");
  await expect(
    page.getByRole("button", { name: "Save flag", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("Player", { exact: true }).selectOption("lead");
  await expect(
    page.getByRole("button", { name: "Save flag", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("Review for").selectOption("team");
  await page.getByRole("button", { name: "Save flag", exact: true }).click();
  await expect(page.getByText(/Flag saved for the team/)).toBeVisible();
  expect(saved).toEqual({ review, shotId: null, expectedRevision: 3 });
  expect(new URL(page.url()).hash).toBe("");
  await expect(
    page.getByRole("link", { name: "View saved flags" }),
  ).toHaveAttribute(
    "href",
    `/shot-tracker?source=streamer&event=standalone&game=${gameId}#analysis/flagged`,
  );
});

test("same-tab sign-in resumes a phone flag without putting its notes in the return URL", async ({
  page,
}) => {
  const pathname = "/shot-tracker/review-import";
  const review = {
    version: 1,
    id: "33333333-3333-4333-8333-333333333333",
    gameId: "11111111-1111-4111-8111-111111111111",
    audience: "team",
    notes: "Discuss sweep call",
    selectedAt: "2026-11-09T20:00:10Z",
    capturedAt: "2026-11-09T20:01:00Z",
    timingEstimated: true,
  };
  await mountFixture(page, pathname, importFixture);
  let signedIn = false;
  await page.route(
    (url) => url.pathname === "/login",
    (route) => {
      const next = new URL(route.request().url()).searchParams.get("next");
      expect(next).toBe(`${pathname}?resume=${review.id}`);
      signedIn = true;
      return route.fulfill({
        contentType: "text/html",
        body: `<a href="${next}">Continue to saved review</a>`,
      });
    },
  );
  let saved: unknown;
  await page.route("**/api/curlcoach/local-review**", (route) => {
    if (!signedIn) return route.fulfill({ status: 403 });
    if (route.request().method() === "GET")
      return route.fulfill({ json: { revision: 1, shots: [] } });
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto(
    `http://127.0.0.1:3189${pathname}#${encodeURIComponent(JSON.stringify(review))}`,
  );
  await expect(page.getByRole("alert")).toContainText("Sign in with access");
  await page.getByLabel("Notes").fill("Updated before signing in");
  await page.getByRole("link", { name: "Sign in to continue" }).click();
  await page.getByRole("link", { name: "Continue to saved review" }).click();
  await expect(page.getByLabel("Notes")).toHaveValue(
    "Updated before signing in",
  );
  await expect(
    page.getByRole("link", { name: "Sign in to continue" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Save flag", exact: true }).click();
  await expect(page.getByText(/Flag saved for the team/)).toBeVisible();
  expect(saved).toEqual({
    review: { ...review, notes: "Updated before signing in" },
    shotId: null,
    expectedRevision: 1,
  });
  expect(new URL(page.url()).search).toBe("");
});

test("a standalone flag adjusts the timestamp and preserves its notes", async ({
  page,
}) => {
  const gameId = "11111111-1111-4111-8111-111111111111";
  const reviewId = "33333333-3333-4333-8333-333333333333";
  const recording = "https://www.youtube.com/watch?v=abcdefghijk";
  const original = {
    id: reviewId,
    audience: "team",
    playerId: null,
    playerName: null,
    note: "Discuss sweep call",
    selectedAt: "2026-11-09T20:02:00Z",
  };
  await mountFixture(
    page,
    "/coach-flags-fixture",
    `
    import {useState, useEffect} from 'react';
    import {createRoot} from 'react-dom/client';
    import FlaggedShots from './src/app/curlcoach/FlaggedShots';
    function Fixture() {
      const [games, setGames] = useState([]);
      async function refresh() { setGames(await (await fetch('/flags-fixture-data')).json()); }
      useEffect(() => { void refresh(); }, []);
      return <FlaggedShots shots={[]} games={games} players={[]} playerId="all" includeStandalone canSave onSaved={refresh}/>;
    }
    createRoot(document.getElementById('root')).render(<Fixture/>);
  `,
  );
  let corrected: { startSeconds: number; note: string } | undefined;
  await page.route("**/flags-fixture-data", (route) =>
    route.fulfill({
      json: [
        {
          id: gameId,
          label: "Game 1",
          opponent: "Rivals",
          broadcastReview: {
            url: recording,
            startedAt: "2026-11-09T20:00:00Z",
          },
          standaloneReviews: [
            corrected
              ? {
                  ...original,
                  note: corrected.note,
                  videoReview: {
                    url: recording,
                    positionSeconds: corrected.startSeconds,
                    lookBackSeconds: 0,
                  },
                }
              : original,
          ],
        },
      ],
    }),
  );
  await page.route("**/api/curlcoach/review", (route) => {
    corrected = route.request().postDataJSON();
    expect(corrected).toEqual({
      gameId,
      reviewId,
      requestId: expect.stringMatching(/^[\da-f-]{36}$/),
      startSeconds: 121,
      note: "Discuss sweep call",
    });
    return route.fulfill({ json: { saved: true } });
  });
  await page.goto("http://127.0.0.1:3189/coach-flags-fixture");
  const link = page.getByRole("link", { name: "Link to video", exact: true });
  const adjust = page.getByRole("button", { name: "Adjust timestamp" });
  const timestamp = page.getByLabel("Timestamp", { exact: true });
  await expect(page.getByRole("link")).toHaveCount(1);
  await expect(timestamp).toHaveCount(0);
  await expect(link).toHaveAttribute("href", `${recording}&t=120s`);
  await adjust.click();
  await expect(timestamp).toHaveValue("0:02:00");
  await timestamp.fill("2:01");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(link).toHaveAttribute("href", `${recording}&t=120s`);
  await adjust.click();
  await expect(timestamp).toHaveValue("0:02:00");
  await timestamp.fill("2:01");
  await page.getByRole("button", { name: "Save timestamp" }).click();
  await expect(link).toHaveAttribute("href", `${recording}&t=121s`);
  await page.reload();
  await expect(link).toHaveAttribute("href", `${recording}&t=121s`);
  await expect(
    page.getByText("Discuss sweep call", { exact: true }),
  ).toBeVisible();
});
