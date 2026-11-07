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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{ProgramUsbAudio}from'./src/components/ProgramUsbAudio';import{ProgramPhoneAudio}from'./src/components/ProgramPhoneAudio';import{createProgramUsbMix}from'./src/lib/program-usb-mix';import{usbAudioStart}from'./src/lib/usb-audio-timing';window.timing=usbAudioStart;window.mix=createProgramUsbMix;window.mount=()=>createRoot(document.getElementById('root')).render(<ProgramUsbAudio/>);window.mountBoth=()=>{const context=new AudioContext();const oscillator=context.createOscillator();const output=context.createMediaStreamDestination();oscillator.connect(output);oscillator.start();window.audioProofContext=context;window.audioProofRoot=createRoot(document.getElementById('root'));window.audioProofRoot.render(<><ProgramUsbAudio/><ProgramPhoneAudio role='camera-home' stream={output.stream} enabled={true}/></>);};`,
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

test("speech processing reduces rumble and peak pressure without adding onset latency", async ({
  page,
}) => {
  const results = await page.evaluate(async () => {
    // Keep the previous graph as a signal-level reference, including the browser's
    // compressor makeup gain and lookahead, rather than estimating a static curve.
    const previousMix = (context: OfflineAudioContext) => {
      const input = context.createGain();
      input.gain.value = 4;
      const speech = context.createDynamicsCompressor();
      speech.threshold.value = -22;
      speech.knee.value = 12;
      speech.ratio.value = 6;
      speech.attack.value = 0.005;
      speech.release.value = 0.35;
      const peak = context.createDynamicsCompressor();
      peak.threshold.value = -3;
      peak.knee.value = 0;
      peak.ratio.value = 20;
      peak.attack.value = 0.003;
      peak.release.value = 0.15;
      const safety = context.createWaveShaper();
      safety.curve = Float32Array.from({ length: 4097 }, (_, i) => {
        const x = (i / 4096) * 2 - 1;
        const magnitude = Math.abs(x);
        return (
          Math.sign(x) *
          (magnitude <= 0.9
            ? magnitude
            : 0.9 + 0.08 * Math.tanh((magnitude - 0.9) / 0.08))
        );
      });
      input
        .connect(speech)
        .connect(peak)
        .connect(safety)
        .connect(context.destination);
      return { input };
    };
    const render = async (
      previous: boolean,
      amplitude: number,
      frequency: number,
    ) => {
      const context = new OfflineAudioContext(1, 48000, 48000);
      const mix = previous
        ? previousMix(context)
        : (window as any).mix(context);
      const source = context.createBufferSource();
      source.buffer = context.createBuffer(1, 48000, 48000);
      const input = source.buffer.getChannelData(0);
      // frequency=0 is a small isolated impulse for measuring graph latency.
      for (let i = 4800; i < input.length; i++)
        input[i] = frequency
          ? amplitude * Math.sin((2 * Math.PI * frequency * (i - 4800)) / 48000)
          : i === 4800
            ? amplitude
            : 0;
      source.connect(mix.input);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      let square = 0;
      let peak = 0;
      let onset = -1;
      for (let i = 0; i < output.length; i++) {
        if (onset < 0 && Math.abs(output[i]) > 1e-7) onset = i;
        peak = Math.max(peak, Math.abs(output[i]));
        if (i >= 24000) square += output[i] ** 2;
      }
      return { rms: Math.sqrt(square / 24000), peak, onset };
    };
    const results = [];
    for (const [amplitude, frequency] of [
      [0.02, 440],
      [0.1, 440],
      [1, 440],
      [4, 440],
      [0.002, 20],
      [0.002, 50],
      [0.002, 160],
      [0.002, 1000],
      [0.001, 0],
    ])
      results.push({
        amplitude,
        frequency,
        before: await render(true, amplitude, frequency),
        after: await render(false, amplitude, frequency),
      });
    return results;
  });
  // Quiet speech stays lifted, while ordinary speech and shouts stay ordered.
  expect(results[0].after.rms).toBeGreaterThan(0.04);
  expect(results[1].after.rms).toBeGreaterThan(results[0].after.rms);
  expect(results[2].after.rms).toBeGreaterThan(results[1].after.rms);
  expect(results[2].after.rms / results[0].after.rms).toBeLessThan(6);
  expect(results[3].after.peak).toBeLessThan(0.89);
  expect(results[3].after.peak).toBeLessThan(results[3].before.peak);
  // Low-frequency mechanical/electrical rumble is reduced; speech-band signal remains.
  expect(results[4].after.rms / results[4].before.rms).toBeLessThan(0.1);
  expect(results[5].after.rms / results[5].before.rms).toBeLessThan(0.3);
  expect(results[6].after.rms / results[7].after.rms).toBeGreaterThan(0.9);
  // A native low-cut introduces no block buffering or extra compressor lookahead.
  expect(results[8].after.onset).toBe(results[8].before.onset);
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

test("phone and USB observation responses drain and dispose successful request signals", async ({
  page,
}) => {
  await page.route("**/usb-audio", (route) => route.fulfill({ status: 204 }));
  await page.route("**/camera", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.evaluate(() => {
    const original = window.fetch.bind(window);
    const records: Array<{
      action: string;
      response: Response;
      signal: AbortSignal;
    }> = [];
    (window as any).observationLifetimes = records;
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (
        String(input) === "/camera" &&
        options?.method === "POST" &&
        options.signal
      )
        records.push({
          action: JSON.parse(options.body as string).action,
          response,
          signal: options.signal,
        });
      return response;
    };
    (window as any).mountBoth();
  });
  for (const action of ["audio-observe", "usb-audio-observe"])
    await expect
      .poll(() =>
        page.evaluate(
          (action) =>
            (window as any).observationLifetimes.filter(
              (row: {
                action: string;
                response: Response;
                signal: AbortSignal;
              }) =>
                row.action === action &&
                row.response.bodyUsed &&
                row.signal.aborted,
            ).length,
          action,
        ),
      )
      .toBeGreaterThan(1);
  await page.evaluate(async () => {
    (window as any).audioProofRoot.unmount();
    await (window as any).audioProofContext.close();
  });
});
