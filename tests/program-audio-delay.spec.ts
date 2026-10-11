import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("changing external microphone delay updates the running audio graph without restarting capture", async ({
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
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {M4ProgramAudio} from './src/lib/providers/m4-program-audio-browser';
        import {gameFixture} from './src/test/game-fixture';
        const root=createRoot(document.getElementById('root'));
        window.updateDelay=milliseconds=>root.render(<M4ProgramAudio game={{...gameFixture(),programAudioDelayMs:milliseconds}} phoneStreams={{}}/>);
        window.updateDelay(0);
      `,
    },
  });
  await page.addInitScript(() => {
    const delays: DelayNode[] = [];
    (window as any).delayNodes = delays;
    const create = AudioContext.prototype.createDelay;
    AudioContext.prototype.createDelay = function (maximum) {
      const delay = create.call(this, maximum);
      delays.push(delay);
      return delay;
    };
  });
  await page.route("**/usb-audio", (route) => route.fulfill({ status: 204 }));
  await page.route("**/camera", (route) => route.fulfill({ json: {} }));
  await page.route("**/delay-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.goto("/delay-fixture");
  await expect
    .poll(() => page.evaluate(() => (window as any).delayNodes.length))
    .toBe(1);
  // OBS permits autoplay; give the ordinary test browser a user gesture.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.evaluate(() => (window as any).delayNodes[0].context.resume());
  for (const milliseconds of [2500, 5000, 0]) {
    await page.evaluate(
      (value) => (window as any).updateDelay(value),
      milliseconds,
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).delayNodes[0].delayTime.value),
      )
      .toBeCloseTo(milliseconds / 1000, 2);
    expect(await page.evaluate(() => (window as any).delayNodes.length)).toBe(
      1,
    );
  }
});
