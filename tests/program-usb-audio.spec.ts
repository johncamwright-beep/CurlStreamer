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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ProgramUsbAudio}from'./src/components/ProgramUsbAudio';import{createProgramUsbMix}from'./src/lib/program-usb-mix';import{usbAudioStart}from'./src/lib/usb-audio-timing';window.timing=usbAudioStart;window.mix=createProgramUsbMix;window.mount=()=>createRoot(document.getElementById('root')).render(<ProgramUsbAudio/>);`,
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
    for (const amplitude of [0.1, 0.4, 4, 0.02, 0]) {
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
  // Quiet speech becomes audible; a 20x input jump produces a much smaller output jump.
  expect(results[3].rms).toBeGreaterThan(0.04);
  expect(results[1].rms / results[3].rms).toBeLessThan(5);
  expect(results[4].rms).toBe(0);
});

test("speech level recovers after shouting without clipping or turning silence into sound", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 144000, 48000);
    const mix = (window as any).mix(context);
    const buffer = context.createBuffer(1, 144000, 48000);
    const input = buffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) {
      const time = i / 48000;
      const amplitude = time >= 2.5 ? 0 : time >= 0.8 && time < 1.2 ? 1 : 0.02;
      input[i] = amplitude * Math.sin(2 * Math.PI * 440 * time);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(mix.input);
    source.start();
    const output = (await context.startRendering()).getChannelData(0);
    const rms = (start: number, end: number) => {
      const samples = output.subarray(start * 48000, end * 48000);
      return Math.sqrt(
        samples.reduce((sum, sample) => sum + sample * sample, 0) /
          samples.length,
      );
    };
    const result = {
      before: rms(0.5, 0.7),
      shout: rms(1, 1.15),
      after: rms(2.1, 2.4),
      silence: rms(2.8, 3),
      peak: output.reduce(
        (peak, sample) => Math.max(peak, Math.abs(sample)),
        0,
      ),
    };
    mix.disconnect();
    return result;
  });
  expect(result.before).toBeGreaterThan(0.04);
  expect(result.shout / result.before).toBeLessThan(6);
  expect(result.after / result.before).toBeGreaterThan(0.85);
  expect(result.peak).toBeLessThan(0.99);
  expect(result.silence).toBe(0);
});

test("USB packet jitter renders a continuous waveform without gaps or repeated samples", async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const context = new OfflineAudioContext(1, 144000, 48000);
    let nextAt = 0;
    const starts: number[] = [];
    for (let packet = 0; packet < 20; packet++) {
      // Timer and HTTP delivery vary by up to 45ms, as on a busy desktop.
      const now = packet * 0.1 + [0, 0.015, 0.045, 0.025][packet % 4];
      const timing = (window as any).timing(nextAt, now);
      const buffer = context.createBuffer(1, 4800, 48000);
      const input = buffer.getChannelData(0);
      for (let i = 0; i < input.length; i++)
        input[i] =
          0.1 * Math.sin((2 * Math.PI * 437 * (packet * 4800 + i)) / 48000);
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      source.start(timing.at);
      starts.push(timing.at);
      nextAt = timing.at + 0.1;
    }
    const output = (await context.startRendering()).getChannelData(0);
    let error = 0;
    const first = Math.round(starts[0] * 48000);
    for (let i = 0; i < 96000; i++)
      error = Math.max(
        error,
        Math.abs(
          output[first + i] - 0.1 * Math.sin((2 * Math.PI * 437 * i) / 48000),
        ),
      );
    return { error, starts };
  });
  expect(result.error).toBeLessThan(0.00001);
  for (let i = 1; i < result.starts.length; i++)
    expect(result.starts[i] - result.starts[i - 1]).toBeCloseTo(0.1, 6);
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
