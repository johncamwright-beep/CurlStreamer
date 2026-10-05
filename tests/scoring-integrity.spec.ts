import { createServer, type Server } from "node:http";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

const game = {
  id: "scoring-game",
  config: {
    eventName: "Club final",
    homeName: "Rocks",
    awayName: "Stones",
    homeColor: "#000000",
    awayColor: "#ffffff",
    scheduledEnds: 8,
    initialHammer: "home",
    youtubeTitle: "Club final",
    youtubeVisibility: "unlisted",
  },
  createdAt: 1,
  scoreEvents: [
    {
      id: "20000000-0000-4000-8000-000000000010",
      at: 1,
      type: "end",
      score: { end: 1, team: "home", points: 1, blank: false },
    },
  ],
  layout: "split",
  broadcast: "idle",
  status: "active",
  audioMuted: false,
  connections: { "camera-home": false, "camera-away": false, scorer: true },
  claims: {},
  sponsors: [],
  sponsorMode: {
    active: false,
    style: "fullscreen",
    intervalSeconds: 4,
    startedAt: null,
    rotationOffset: 0,
    paused: false,
    mutedPrevious: false,
    muteDuring: true,
  },
};

let server: Server;
let origin: string;

test.beforeAll(async () => {
  const bundle = await build({
    bundle: true,
    format: "iife",
    jsx: "automatic",
    platform: "browser",
    write: false,
    loader: { ".css": "empty" },
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `
        import React, { Suspense } from "react";
        import { createRoot } from "react-dom/client";
        import Scorer from "./src/app/score/[id]/page";
        globalThis.__game = ${JSON.stringify(game)};
        globalThis.__calls = [];
        globalThis.__game2 = {...structuredClone(globalThis.__game), id:"scoring-game2"};
        globalThis.__holdReads = false;
        globalThis.__reads = [];
        globalThis.fetch = (url, options = {}) => {
          if (!String(url).startsWith("/api/games/scoring-game")) return Promise.resolve(new Response("{}"));
          const state = String(url) === "/api/games/scoring-game2" ? globalThis.__game2 : globalThis.__game;
          if (options.method !== "PATCH") {
            const snapshot = structuredClone(state);
            if (globalThis.__holdReads) return new Promise(resolve => globalThis.__reads.push(() => resolve(new Response(JSON.stringify(snapshot), {headers:{"x-curlcast-account-role":"owner"}}))));
            return Promise.resolve(new Response(JSON.stringify(snapshot), {headers:{"x-curlcast-account-role":"owner"}}));
          }
          const action = JSON.parse(options.body);
          globalThis.__calls.push(action);
          return new Promise((resolve, reject) => {
            globalThis.__commitAction = () => {
              const event = action.type === "score" ? {id:action.intentId,at:2,type:"end",score:{end:action.expectedEnd,team:action.team,points:action.points,blank:action.blank},expectedLastEventId:action.expectedLastEventId} : action.type === "undo" ? {id:action.intentId,at:2,type:"undo",targetId:action.expectedTargetId,expectedLastEventId:action.expectedLastEventId} : {id:action.intentId,at:2,type:"hammer",team:action.team,expectedEnd:action.expectedEnd,expectedLastEventId:action.expectedLastEventId};
              if (!state.scoreEvents.some(e => e.id === action.intentId)) state.scoreEvents.push(event);
            };
            globalThis.__resolveAction = () => {
              globalThis.__commitAction();
              resolve(new Response(JSON.stringify(state)));
            };
            globalThis.__rejectAction = reject;
            globalThis.__conflictAction = () => resolve(new Response(JSON.stringify({error:"The game changed before this update was saved. Try again.",code:"scoring_stale_intent"}), {status:409}));
            globalThis.__malformedAction = () => resolve(new Response(JSON.stringify(state)));
          });
        };
        const root = createRoot(document.getElementById("root"));
        globalThis.__navigate = (id) => {
          const params = Promise.resolve({id});
          root.render(React.createElement(Suspense, {fallback:"Loading"}, React.createElement(Scorer, {params})));
        };
        globalThis.__navigate("scoring-game");
      `,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    plugins: [
      {
        name: "scoring-page-test-boundaries",
        setup(builder) {
          const stubs = new Map([
            [
              "next/link",
              `import React from "react";
               export default function Link(props) {
                 return React.createElement("a", { ...props, href: props.href }, props.children);
               }`,
            ],
            [
              "@/components/GameSetupNavigation",
              "export function GameSetupNavigation() { return null; }",
            ],
            [
              "@/components/AppNavigation",
              "export function AppNavigation() { return null; }",
            ],
            [
              "@/components/Scoreboard",
              "export function Scoreboard() { return null; }",
            ],
            [
              "@/components/CompletedGameSummary",
              "export function CompletedGameSummary() { return null; }",
            ],
            [
              "@/components/EndGameControl",
              "export function EndGameControl({ enabled, disabled }) { return enabled ? <button disabled={disabled}>End Game</button> : null; }",
            ],
            [
              "@/components/BroadcastControl",
              "export function BroadcastControl() { return null; }",
            ],
          ]);
          builder.onResolve({ filter: /.*/ }, (args) =>
            stubs.has(args.path)
              ? { path: args.path, namespace: "test-stub" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "test-stub" }, (args) => ({
            contents: stubs.get(args.path),
            loader: "jsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const javascript = bundle.outputFiles[0].text;
  server = createServer((request, response) => {
    if (request.url === "/bundle.js") {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(javascript);
      return;
    }
    response.writeHead(200, { "content-type": "text/html" });
    response.end(
      '<main><div id="root"></div><script src="/bundle.js"></script></main>',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test server");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(
  () =>
    new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    ),
);

test("guards duplicate score clicks and retries the same intent after lost response", async ({
  page,
}) => {
  await page.goto(origin);
  const save = page.getByRole("button", { name: "Save 1 point" });
  const endGame = page.getByRole("button", { name: "End Game" });
  await expect(save).toBeEnabled();
  await expect(endGame).toBeEnabled();

  await save.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await expect(save).toBeDisabled();
  await expect(endGame).toBeDisabled();
  await expect(page.getByRole("status", { name: "Scoring update" })).toHaveText(
    "Saving scoring change…",
  );
  const first = await page.evaluate(() =>
    structuredClone((globalThis as unknown as { __calls: unknown[] }).__calls),
  );
  expect(first).toHaveLength(1);
  expect(first[0]).toMatchObject({
    type: "score",
    expectedEnd: 2,
    expectedLastEventId: "20000000-0000-4000-8000-000000000010",
    team: "home",
    points: 1,
    blank: false,
  });

  await page.evaluate(() => {
    (globalThis as any).__commitAction();
    (globalThis as any).__rejectAction(
      new Error("Connection dropped after saving"),
    );
  });
  await expect(
    page.getByRole("alert", { name: "Scoring error" }),
  ).toContainText("Save confirmation was not received");
  await page.getByRole("button", { name: "Retry same change" }).click();
  const second = await page.evaluate(() =>
    structuredClone((globalThis as unknown as { __calls: unknown[] }).__calls),
  );
  expect(second).toHaveLength(2);
  expect(second[1]).toEqual(first[0]);
  await page.evaluate(() =>
    (
      globalThis as unknown as { __resolveAction: () => void }
    ).__resolveAction(),
  );
  await expect(page.getByRole("status", { name: "Scoring update" })).toHaveText(
    "End 2 saved.",
  );
});

test("shows and submits the exact append-only Undo effect", async ({
  page,
}) => {
  await page.goto(origin);
  await expect(
    page.getByText("Undo will reverse End 1 while keeping its history."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Undo last scoring change" }).click();
  const action = await page.evaluate(() =>
    structuredClone(
      (globalThis as unknown as { __calls: unknown[] }).__calls[0],
    ),
  );
  expect(action).toMatchObject({
    type: "undo",
    expectedLastEventId: "20000000-0000-4000-8000-000000000010",
    expectedTargetId: "20000000-0000-4000-8000-000000000010",
  });
  await page.evaluate(() =>
    (
      globalThis as unknown as { __resolveAction: () => void }
    ).__resolveAction(),
  );
  await expect(
    page.getByRole("status", { name: "Scoring update" }),
  ).toContainText("prior change remains in history");
});

for (const beforeAck of [true, false]) {
  test(`a delayed poll delivered ${beforeAck ? "before" : "after"} acknowledgement cannot rebind the next end`, async ({
    page,
  }) => {
    await page.goto(origin);
    const save = page.getByRole("button", { name: "Save 1 point" });
    await expect(save).toBeEnabled();
    await page.evaluate(() => {
      (globalThis as any).__holdReads = true;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(() => page.evaluate(() => (globalThis as any).__reads.length))
      .toBe(1);
    await save.click();
    await expect(save).toBeDisabled();
    await expect(
      page.getByRole("heading", { name: "Record End 2" }),
    ).toBeVisible();
    if (beforeAck)
      await page.evaluate(() => (globalThis as any).__reads.shift()());
    await page.evaluate(() => (globalThis as any).__resolveAction());
    await expect(
      page.getByRole("heading", { name: "Record End 3" }),
    ).toBeVisible();
    await page.evaluate((beforeAck) => {
      if (!beforeAck) (globalThis as any).__reads.shift()();
      (globalThis as any).__holdReads = false;
    }, beforeAck);
    await expect(save).toBeEnabled();
    await save.click();
    expect(
      await page.evaluate(() =>
        (globalThis as any).__calls.map((action: any) => action.expectedEnd),
      ),
    ).toEqual([2, 3]);
    await page.evaluate(() => (globalThis as any).__resolveAction());
    await expect(
      page.getByRole("heading", { name: "Record End 4" }),
    ).toBeVisible();
  });
}

test("missing persisted intent keeps scoring locked until the same change is confirmed", async ({
  page,
}) => {
  await page.goto(origin);
  const save = page.getByRole("button", { name: "Save 1 point" });
  await save.click();
  await page.evaluate(() => (globalThis as any).__malformedAction());
  await expect(
    page.getByRole("alert", { name: "Scoring error" }),
  ).toContainText("Save confirmation was not received");
  await expect(save).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Review current score" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Retry same change" }).click();
  expect(await page.evaluate(() => (globalThis as any).__calls[1])).toEqual(
    await page.evaluate(() => (globalThis as any).__calls[0]),
  );
  await page.evaluate(() => (globalThis as any).__resolveAction());
  await expect(
    page.getByRole("heading", { name: "Record End 3" }),
  ).toBeVisible();
});

test("a definitive stale intent loads the current score before allowing review", async ({
  page,
}) => {
  await page.goto(origin);
  await page.getByRole("button", { name: "Save 1 point" }).click();
  await page.evaluate(() => {
    (globalThis as any).__game.scoreEvents.push({
      id: "other-score",
      at: 2,
      type: "end",
      score: { end: 2, team: "away", points: 2, blank: false },
    });
    (globalThis as any).__conflictAction();
  });
  await expect(
    page.getByRole("heading", { name: "Record End 3" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry same change" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Review current score" }).click();
  await page.getByRole("button", { name: "Save 1 point" }).click();
  expect(
    await page.evaluate(() => (globalThis as any).__calls[1].expectedEnd),
  ).toBe(3);
});

test("changing game during a pending save isolates its acknowledgement and scoring locks", async ({
  page,
}) => {
  await page.goto(origin);
  const save = page.getByRole("button", { name: "Save 1 point" });
  await save.click();
  await expect(save).toBeDisabled();
  await page.evaluate(() => (globalThis as any).__navigate("scoring-game2"));
  await expect(save).toBeEnabled();
  await page.evaluate(() => (globalThis as any).__resolveAction());
  await expect(
    page.getByRole("heading", { name: "Record End 2" }),
  ).toBeVisible();
  await expect(save).toBeEnabled();
  await expect(page.getByRole("alert", { name: "Scoring error" })).toHaveCount(
    0,
  );
  await save.click();
  expect(
    await page.evaluate(() => (globalThis as any).__calls[1].expectedEnd),
  ).toBe(2);
});
