import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("phone microphone delay updates its existing graph and disconnects replaced or disabled sources", async ({
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
        import {ProgramPhoneAudio} from './src/components/ProgramPhoneAudio';
        const context=new AudioContext();
        const oscillator=context.createOscillator();
        const outputs=[context.createMediaStreamDestination(),context.createMediaStreamDestination()];
        for(const output of outputs) oscillator.connect(output);
        oscillator.start();
        const root=createRoot(document.getElementById('root'));
        window.phoneStreams=outputs.map(output=>output.stream);
        window.updatePhone=({delayMs=2500,source=0,enabled=true}={})=>root.render(
          <ProgramPhoneAudio role='camera-home' stream={outputs[source].stream} enabled={enabled} delayMs={delayMs}/>
        );
        window.closePhone=async()=>{
          root.unmount();
          oscillator.stop();
          for(const output of outputs) for(const track of output.stream.getTracks()) track.stop();
          await context.close();
        };
        window.updatePhone();
      `,
    },
  });
  await page.addInitScript(() => {
    const records = { delays: [] as any[], sources: [] as any[] };
    (window as any).phoneGraph = records;
    const createDelay = AudioContext.prototype.createDelay;
    AudioContext.prototype.createDelay = function (maximum) {
      const node = createDelay.call(this, maximum);
      const record = { node, disconnects: 0 };
      records.delays.push(record);
      const disconnect = node.disconnect.bind(node);
      node.disconnect = () => {
        record.disconnects++;
        disconnect();
      };
      return node;
    };
    const createSource = AudioContext.prototype.createMediaStreamSource;
    AudioContext.prototype.createMediaStreamSource = function (stream) {
      const node = createSource.call(this, stream);
      const record = { node, disconnects: 0 };
      records.sources.push(record);
      const disconnect = node.disconnect.bind(node);
      node.disconnect = () => {
        record.disconnects++;
        disconnect();
      };
      return node;
    };
  });
  await page.route("**/camera", (route) => route.fulfill({ json: {} }));
  await page.route("**/phone-delay-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.goto("/phone-delay-fixture");
  await expect
    .poll(() => page.evaluate(() => (window as any).phoneGraph.delays.length))
    .toBe(1);
  expect(
    await page.evaluate(
      () => (window as any).phoneGraph.delays[0].node.delayTime.value,
    ),
  ).toBeCloseTo(2.5, 2);
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.evaluate(() =>
    (window as any).phoneGraph.delays[0].node.context.resume(),
  );
  for (const delayMs of [5000, -2000, 0]) {
    await page.evaluate(
      (delayMs) => (window as any).updatePhone({ delayMs }),
      delayMs,
    );
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as any).phoneGraph.delays[0].node.delayTime.value,
        ),
      )
      .toBeCloseTo(Math.max(0, delayMs) / 1000, 2);
    expect(
      await page.evaluate(() => ({
        delays: (window as any).phoneGraph.delays.length,
        sources: (window as any).phoneGraph.sources.length,
        disconnected: (window as any).phoneGraph.delays[0].disconnects,
      })),
    ).toEqual({ delays: 1, sources: 1, disconnected: 0 });
  }
  await page.evaluate(() =>
    (window as any).updatePhone({ source: 1, delayMs: 750 }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        delays: (window as any).phoneGraph.delays.length,
        sources: (window as any).phoneGraph.sources.length,
        oldDelayDisconnected: (window as any).phoneGraph.delays[0].disconnects,
        oldSourceDisconnected: (window as any).phoneGraph.sources[0]
          .disconnects,
      })),
    )
    .toEqual({
      delays: 2,
      sources: 2,
      oldDelayDisconnected: 1,
      oldSourceDisconnected: 1,
    });
  expect(
    await page.evaluate(
      () => (window as any).phoneGraph.delays[1].node.delayTime.value,
    ),
  ).toBeCloseTo(0.75, 2);
  await page.evaluate(() =>
    (window as any).updatePhone({ source: 1, enabled: false }),
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        delay: (window as any).phoneGraph.delays[1].disconnects,
        source: (window as any).phoneGraph.sources[1].disconnects,
      })),
    )
    .toEqual({ delay: 1, source: 1 });
  // Playout cleanup releases its graph without stopping caller-owned capture.
  expect(
    await page.evaluate(() =>
      (window as any).phoneStreams.every((stream: MediaStream) =>
        stream.getAudioTracks().every((track) => track.readyState === "live"),
      ),
    ),
  ).toBe(true);
  await page.evaluate(() => (window as any).closePhone());
});

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
  for (const milliseconds of [2500, 5000, -2000, 0]) {
    await page.evaluate(
      (value) => (window as any).updateDelay(value),
      milliseconds,
    );
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).delayNodes[0].delayTime.value),
      )
      .toBeCloseTo(Math.max(0, milliseconds) / 1000, 2);
    expect(await page.evaluate(() => (window as any).delayNodes.length)).toBe(
      1,
    );
  }
});
