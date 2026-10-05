import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("Studio YouTube sends game-scoped commands and expires live status", async ({
  page,
}) => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioYouTube} from './src/components/StudioYouTube';window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};createRoot(document.getElementById('root')).render(<StudioYouTube id="fixture-game"/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/youtube-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/youtube-fixture.js"></script>',
    }),
  );
  await page.route("**/youtube-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.clock.install();
  const requests: unknown[] = [];
  const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
  await page.route("**/api/games/fixture-game/studio-m4", (r) => {
    if (r.request().method() === "POST")
      requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: { desiredState: "live", status: "prepared", watchUrl },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    });
  });
  await page.goto("/youtube-fixture");
  const start = page.getByRole("button", { name: "Broadcast to YouTube" });
  await expect(start).toBeDisabled();
  const report = async (
    gameId: string,
    live = false,
    receiving = live,
    streaming = receiving ? "armed" : "idle",
  ) =>
    page.evaluate(
      ({ gameId, live, receiving, streaming }) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", {
            detail: {
              gameId,
              available: true,
              busy: false,
              streaming,
              live,
              receiving,
              message: "",
              canReconnect: true,
              outputActive: false,
            },
          }),
        ),
      { gameId, live, receiving, streaming },
    );
  await report("wrong-game", true);
  await expect(start).toBeDisabled();
  await report("fixture-game");
  await start.click();
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([{ type: "studio-youtube-start", gameId: "fixture-game" }]);
  expect(requests).toHaveLength(0);
  await report("fixture-game", false, true);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests).toEqual([{ action: "go-live" }]);
  await expect(
    page.getByRole("button", { name: "Go live", exact: true }),
  ).toHaveCount(0);
  // YouTube may acknowledge the request before it finishes going live.
  await page.clock.fastForward(11000);
  await report("fixture-game", false, true);
  await expect.poll(() => requests.length).toBe(2);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", true);
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page.getByRole("button", { name: "Copy link" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(watchUrl);
  await report("fixture-game", false, false, "armed");
  await expect(page.getByRole("status")).toHaveText("Checking status…");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(11000);
  await report("fixture-game", false, true, "armed");
  await expect(page.getByRole("status")).toHaveText("Receiving video");
  // Losing a status sample does not request another live transition for an
  // already confirmed broadcast or hide its verified watch destination.
  expect(requests).toHaveLength(2);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", true);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([
    { type: "studio-youtube-start", gameId: "fixture-game" },
    { type: "studio-youtube-stop", gameId: "fixture-game" },
  ]);
  await report("fixture-game", false, false, "paused");
  await expect(page.getByRole("status")).toHaveText("Disconnected");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await report("fixture-game", true);
  await page.clock.fastForward(7000);
  await expect(page.getByRole("status")).toHaveText("Status unavailable");
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", false, false, "stopped");
  await expect(page.getByRole("status")).toHaveText("Not live");
  await expect(start).toBeEnabled();
  // Older launchers still interpret Stop as final completion. Never send a
  // pause command until the native bridge advertises the new capability.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          message: "",
        },
      }),
    ),
  );
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Update Windows Studio/)).toBeVisible();
});

test("capable Studio pauses on a card and resumes without disconnecting or changing the watch link", async ({
  page,
}) => {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioYouTube} from './src/components/StudioYouTube';window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};createRoot(document.getElementById('root')).render(<StudioYouTube id="fixture-game"/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/youtube-hold-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/youtube-hold-fixture.js"></script>',
    }),
  );
  await page.route("**/youtube-hold-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
  const mutations: unknown[] = [];
  await page.route("**/api/games/fixture-game/studio-m4", (r) => {
    if (r.request().method() === "POST")
      mutations.push(r.request().postDataJSON());
    return r.fulfill({ json: { watchUrl } });
  });
  await page.goto("/youtube-hold-fixture");
  const report = async (mode: "live" | "hold") =>
    page.evaluate(
      (mode) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", {
            detail: {
              gameId: "fixture-game",
              available: true,
              busy: false,
              streaming: "armed",
              live: true,
              receiving: true,
              outputActive: true,
              message: "",
              canReconnect: true,
              canHoldStream: true,
              presentation: { mode },
            },
          }),
        ),
      mode,
    );
  await report("live");
  await page
    .getByRole("button", { name: "Pause broadcast", exact: true })
    .click();
  await report("hold");
  await expect(page.getByRole("status")).toHaveText("● LIVE · Paused");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page
    .getByRole("button", { name: "Resume broadcast", exact: true })
    .click();
  await report("live");
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([
    { type: "studio-youtube-hold", gameId: "fixture-game" },
    { type: "studio-youtube-resume", gameId: "fixture-game" },
  ]);
  expect(mutations).toHaveLength(0);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
});
