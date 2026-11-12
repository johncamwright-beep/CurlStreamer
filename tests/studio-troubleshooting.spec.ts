import { expect, test } from "@playwright/test";
import { build } from "esbuild";
test("troubleshooting uses local events, isolates games and exports safe measurements", async ({
  page,
}) => {
  const game = "00000000-0000-4000-8000-000000000001";
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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{StudioTroubleshooting}from'./src/components/StudioTroubleshooting';createRoot(document.getElementById('root')).render(<StudioTroubleshooting gameId="${game}"/>);`,
    },
  });
  await page.route("**/diagnostic-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/diagnostic-fixture.js"></script>',
    }),
  );
  await page.route("**/diagnostic-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/diagnostic-fixture");
  await page
    .getByRole("button", { name: "Troubleshooting", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save troubleshooting report" }),
  ).toBeDisabled();
  await page.evaluate((game) => {
    const camera = {
      kind: "tapo",
      host: "192.168.1.2",
      stream: "stream1",
      rotation: 0,
      configured: true,
      connectionEnabled: true,
      phase: "streaming",
      errorCode: null,
      generation: 1,
      zoom: 1,
    };
    const payload = {
      gameId: game,
      capturedAt: Date.now(),
      cameras: { "camera-home": camera, "camera-away": camera },
      nativeHealth: {
        capturedAt: Date.now(),
        targetKbps: 6000,
        sentKbps: 4500,
        congestion: 0.3,
        droppedFrames: 2,
        totalFrames: 100,
        adaptiveBitrate: true,
        renderFps: 30,
        renderMs: 4,
        renderSkippedFrames: 0,
      },
    };
    window.dispatchEvent(
      new CustomEvent("studio-local-health", { detail: payload }),
    );
  }, game);
  await expect(
    page.getByRole("heading", { name: "Camera 1 · streaming" }),
  ).toBeVisible();
  await expect(page.getByText("4,500 kbps", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save troubleshooting report" }),
  ).toBeEnabled();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-local-health", {
        detail: { gameId: "another-game" },
      }),
    ),
  );
  await expect(page.getByText("4,500 kbps", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
});
