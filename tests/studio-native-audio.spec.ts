import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("native USB capture is opt-in with independent meters and scoped controls", async ({
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
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{StudioNativeUsbAudio}from'./src/components/StudioNativeUsbAudio';createRoot(document.getElementById('root')).render(<StudioNativeUsbAudio gameId="game"/>);`,
    },
  });
  await page.route("**/native-audio", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/native-audio.js"></script>',
    }),
  );
  await page.route("**/native-audio.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.addInitScript(() => {
    (window as any).messages = [];
    (window as any).chrome = {
      webview: {
        postMessage: (v: unknown) => (window as any).messages.push(v),
      },
    };
  });
  await page.goto("/native-audio");
  expect(await page.evaluate(() => (window as any).messages)).toEqual([]);
  await page.getByRole("button", { name: "Find microphones" }).click();
  expect(await page.evaluate(() => (window as any).messages)).toEqual([
    { type: "studio-usb-list", gameId: "game" },
  ]);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId: "game",
          devices: [{ id: "receiver", name: "DJI" }],
          running: false,
          error: null,
          channels: [],
        },
      }),
    ),
  );
  await page.getByRole("combobox").selectOption("receiver");
  await page.getByRole("button", { name: "Use USB audio" }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-start",
    gameId: "game",
    deviceId: "receiver",
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId: "other",
          devices: [],
          running: true,
          error: null,
          channels: [{ peak: 1, rms: 1, muted: false, level: 1 }],
        },
      }),
    ),
  );
  await expect(page.getByRole("meter")).toHaveCount(0);
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId: "game",
          devices: [{ id: "receiver", name: "DJI" }],
          running: true,
          error: null,
          channels: [0.1, 0.2, 0.3, 0.4].map((peak) => ({
            peak,
            rms: peak / 2,
            muted: false,
            level: 1,
          })),
        },
      }),
    ),
  );
  await expect(page.getByRole("meter")).toHaveCount(4);
  await expect(
    page.getByRole("meter", { name: "Mic 3 level" }),
  ).toHaveAttribute("value", "0.3");
  await page.getByRole("button", { name: "Mute", exact: true }).nth(2).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-channel",
    gameId: "game",
    channel: 2,
    muted: true,
    level: 1,
  });
  await page.getByRole("button", { name: "Turn off USB audio" }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-stop",
    gameId: "game",
  });
});
