import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test.beforeEach(async ({ page }) => {
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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ProgramUsbAudio}from'./src/components/ProgramUsbAudio';import{createProgramUsbMix}from'./src/lib/program-usb-mix';window.mix=createProgramUsbMix;window.mount=()=>createRoot(document.getElementById('root')).render(<ProgramUsbAudio/>);`,
    },
  });
  await page.route("**/usb-proof", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/usb-proof.js"></script>',
    }),
  );
  await page.route("**/usb-proof.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/usb-proof");
});

test("USB mix preserves one microphone and bounds four simultaneous loud inputs", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    const results = [];
    for (const amplitude of [0.1, 0.4, 4]) {
      const context = new OfflineAudioContext(1, 48000, 48000);
      const mix = (window as any).mix(context);
      const buffer = context.createBuffer(1, 48000, 48000);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++)
        samples[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(mix.input);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      let square = 0,
        peak = 0;
      for (let i = 0; i < output.length; i++) {
        peak = Math.max(peak, Math.abs(output[i]));
        if (i >= 12000) square += output[i] ** 2;
      }
      results.push({ amplitude, peak, rms: Math.sqrt(square / 36000) });
      mix.disconnect();
    }
    return results;
  });
  expect(results[0].rms).toBeGreaterThan(0.06);
  expect(results[1].rms).toBeGreaterThan(0.2);
  for (const result of results) expect(result.peak).toBeLessThan(0.99);
});

test("USB playback continues after a delayed response body exceeds its timeout", async ({
  page,
}) => {
  await page.evaluate(() => {
    (window as any).reads = 0;
    window.fetch = async (input) => {
      if (String(input) === "/camera") return new Response("{}");
      (window as any).reads++;
      const first = (window as any).reads === 1;
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: async () => {
          if (first) await new Promise((resolve) => setTimeout(resolve, 650));
          return new Float32Array(2400).buffer;
        },
      } as Response;
    };
    (window as any).mount();
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).reads))
    .toBeGreaterThan(2);
});
