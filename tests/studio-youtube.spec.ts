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
  await page.goto("/youtube-fixture");
  const start = page.getByRole("button", { name: "Broadcast to YouTube" });
  await expect(start).toBeDisabled();
  const report = async (gameId: string, live = false) =>
    page.evaluate(
      ({ gameId, live }) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", {
            detail: {
              gameId,
              available: true,
              busy: false,
              streaming: live ? "armed" : "idle",
              live,
              receiving: live,
              message: "",
            },
          }),
        ),
      { gameId, live },
    );
  await report("wrong-game", true);
  await expect(start).toBeDisabled();
  await report("fixture-game");
  await start.click();
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([{ type: "studio-youtube-start", gameId: "fixture-game" }]);
  await report("fixture-game", true);
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await page.clock.fastForward(7000);
  await expect(page.getByRole("status")).toHaveText("Not live");
  await expect(start).toBeDisabled();
});
