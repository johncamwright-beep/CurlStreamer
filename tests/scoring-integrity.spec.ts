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
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `
        import React, { Suspense } from "react";
        import { createRoot } from "react-dom/client";
        import Scorer from "./src/app/score/[id]/page";
        globalThis.__game = ${JSON.stringify(game)};
        globalThis.__calls = [];
        globalThis.__act = (action) => {
          globalThis.__calls.push(action);
          return new Promise((resolve, reject) => {
            globalThis.__resolveAction = resolve;
            globalThis.__rejectAction = reject;
          });
        };
        const params = Promise.resolve({ id: "scoring-game" });
        createRoot(document.getElementById("root")).render(
          React.createElement(Suspense, { fallback: "Loading" },
            React.createElement(Scorer, { params })
          )
        );
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
              "@/components/GameSync",
              `export function useGame() {
                return {
                  game: globalThis.__game,
                  completion: undefined,
                  error: "",
                  act: globalThis.__act,
                  accountOperator: false,
                  accountRole: "owner"
                };
              }`,
            ],
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

test("guards duplicate score clicks and retries the same intent after conflict", async ({
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
  await expect(page.getByRole("status")).toHaveText("Saving scoring change…");
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

  await page.evaluate(() =>
    (
      globalThis as unknown as { __rejectAction: (error: Error) => void }
    ).__rejectAction(
      new Error("The game changed before this update was saved. Try again."),
    ),
  );
  await expect(page.getByRole("alert")).toContainText("The game changed");
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
  await expect(page.getByRole("status")).toHaveText("End 2 saved.");
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
  await expect(page.getByRole("status")).toContainText(
    "prior change remains in history",
  );
});
