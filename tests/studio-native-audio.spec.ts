import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("native USB capture is opt-in with compact independent dBFS meters", async ({
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
  await expect(page.getByRole("meter")).toHaveCount(4);
  await expect(page.getByRole("slider").first()).toBeDisabled();
  await expect(page.getByRole("button", { name: "USB setup" })).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.getByRole("button", { name: "USB setup" }).click();
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
  await expect(page.getByRole("meter")).toHaveCount(4);
  await expect(page.getByRole("meter").first()).toHaveAttribute(
    "aria-valuetext",
    "Disconnected; disconnected",
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId: "game",
          devices: [{ id: "receiver", name: "DJI" }],
          running: true,
          error: null,
          channels: [0, 0.1, 0.3, 0.8].map((peak) => ({
            peak,
            rms: peak / 2,
            muted: false,
            level: 1,
          })),
        },
      }),
    ),
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("meter")).toHaveCount(4);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find microphones" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("meter", { name: "Mic 3 receiver input" }),
  ).toHaveAttribute("aria-valuetext", "-10.5 dBFS; receiver input");
  await expect(
    page.getByRole("meter", { name: "Mic 1 receiver input" }),
  ).toHaveAttribute("aria-valuetext", "Silent; receiver input");
  await expect(
    page.getByRole("meter", { name: "Mic 1 receiver input" }).locator("div"),
  ).toHaveCSS("width", "0px");
  await expect(
    page.getByRole("meter", { name: "Mic 2 receiver input" }).locator("div"),
  ).toHaveClass(/bg-emerald-500/);
  await expect(
    page.getByRole("meter", { name: "Mic 3 receiver input" }).locator("div"),
  ).toHaveClass(/bg-emerald-500/);
  await expect(
    page.getByRole("meter", { name: "Mic 4 receiver input" }).locator("div"),
  ).toHaveClass(/bg-amber-400/);
  await expect(page.getByText("Low headroom", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Full scale reached", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("slider", { name: "Mic 4 stream level" }),
  ).toHaveAttribute("aria-valuetext", "100 percent");
  await page.getByRole("button", { name: "Mute", exact: true }).nth(2).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-channel",
    gameId: "game",
    channel: 2,
    muted: true,
    level: 1,
  });
  // Collapsing the panel must keep capture and the stop control available.
  await page.getByRole("button", { name: "Mute all", exact: true }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-mute-all",
    gameId: "game",
    muted: true,
  });
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-usb-status", {
        detail: {
          gameId: "game",
          devices: [],
          running: true,
          allMuted: true,
          error: null,
          channels: [
            { peak: 1, rms: 0.05, muted: false, level: 0.25 },
            { peak: 0.8, rms: 0.05, clipped: true, muted: true, level: 0.25 },
          ],
        },
      }),
    ),
  );
  // Input telemetry remains visible even when the stream mix is quiet/muted.
  await expect(
    page.getByRole("meter", { name: "Mic 1 receiver input" }),
  ).toHaveAttribute("aria-valuetext", "0.0 dBFS; full scale");
  await expect(
    page.getByRole("meter", { name: "Mic 2 receiver input" }),
  ).toHaveAttribute("aria-valuetext", "-1.9 dBFS; full scale reached");
  await expect(page.getByText("Stream muted", { exact: true })).toHaveCount(4);
  await page.getByRole("button", { name: "USB setup" }).click();
  // Cleanup is opt-in to native support; older snapshots keep the meters usable.
  await expect(
    page.getByRole("combobox", { name: "Noise reduction" }),
  ).toHaveCount(0);
  const publishProcessing = async (processing: unknown, gameId = "game") =>
    page.evaluate(
      ({ processing, gameId }) => {
        window.dispatchEvent(
          new CustomEvent("studio-usb-status", {
            detail: {
              gameId,
              devices: [],
              running: true,
              allMuted: true,
              error: null,
              channels: [{ peak: 0.1, rms: 0.05, muted: false, level: 1 }],
              processing,
            },
          }),
        );
      },
      { processing, gameId },
    );
  const initialProcessing = {
    noiseReduction: "gentle",
    humFrequency: 0,
    available: true,
    error: null,
  };
  await publishProcessing(initialProcessing, "other");
  await expect(
    page.getByRole("combobox", { name: "Noise reduction" }),
  ).toHaveCount(0);
  await publishProcessing(initialProcessing);
  const noise = page.getByRole("combobox", { name: "Noise reduction" });
  const hum = page.getByRole("combobox", { name: "Hum filter" });
  await expect(noise).toHaveValue("gentle");
  await expect(hum).toHaveValue("0");
  await noise.selectOption("strong");
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-processing",
    gameId: "game",
    noiseReduction: "strong",
    humFrequency: 0,
  });
  await publishProcessing({ ...initialProcessing, noiseReduction: "strong" });
  await hum.selectOption("60");
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-processing",
    gameId: "game",
    noiseReduction: "strong",
    humFrequency: 60,
  });
  await publishProcessing({
    ...initialProcessing,
    noiseReduction: "strong",
    humFrequency: 60,
  });
  // Reject unknown processing values rather than showing an unsupported mode.
  await publishProcessing({
    ...initialProcessing,
    noiseReduction: "automatic",
    humFrequency: 120,
  });
  await expect(noise).toHaveValue("strong");
  await expect(hum).toHaveValue("60");
  await publishProcessing({
    ...initialProcessing,
    noiseReduction: "off",
    available: false,
    error: "Noise reduction library unavailable.",
  });
  await expect(noise).toBeDisabled();
  await expect(hum).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText(
    "Noise reduction library unavailable.",
  );
  await hum.selectOption("50");
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-processing",
    gameId: "game",
    noiseReduction: "off",
    humFrequency: 50,
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Unmute all", exact: true }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-mute-all",
    gameId: "game",
    muted: false,
  });
  const messagesBeforeCollapse = await page.evaluate(
    () => (window as any).messages.length,
  );
  await page.getByRole("button", { name: "USB setup" }).click();
  await expect(page.getByRole("meter")).toHaveCount(4);
  await expect(
    page.getByRole("combobox", { name: "Hum filter" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();
  expect(await page.evaluate(() => (window as any).messages.length)).toBe(
    messagesBeforeCollapse,
  );
  await page.getByRole("button", { name: "Disconnect" }).click();
  expect(await page.evaluate(() => (window as any).messages.at(-1))).toEqual({
    type: "studio-usb-stop",
    gameId: "game",
  });
});
