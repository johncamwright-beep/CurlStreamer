import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { build } from "esbuild";

const game = "00000000-0000-4000-8000-000000000001";
const takeoverMessage =
  "This camera is connected from another tab. Use that tab, or tap Connect phone here to take over.";

async function fixture(context: BrowserContext) {
  const mocks: Record<string, string> = {
    qrcode: "export default {toDataURL:async()=>''}",
    "next/image": "export default function Image(){return null}",
    "@/lib/access-session":
      "export const cameraPublishAccessToken=()=> 'fixture-phone-token';export const organizerAccessToken=()=>'';export const preserveAndStoreParticipantAccess=()=>{}",
    "@/lib/providers/livekit-client":
      "export const hardwareZoomRange=()=>undefined;export const clampZoom=(value)=>value",
    "@/lib/providers/camera-capture": `export const deviceIsPortrait=()=>true;export async function acquireRawPortraitCamera(_devices,_video,_portrait,onTrack,_mode,includeAudio){await navigator.mediaDevices.getUserMedia({audio:includeAudio,video:true});const h=window.__tabCamera;onTrack?.(h.video);return {track:h.video,audioTrack:includeAudio?h.audio:undefined,report:{}}}`,
    "@/lib/providers/m2-studio-browser": `export async function connectStudio(options){const h=window.__tabCamera;const provider={onStop:options.onStop,stopped:0,stop(){if(!this.stopped)this.stopped++},async replaceAudioTrack(track){if(track)h.publishedAudio.push(track)}};h.providers.push(provider);if(h.deferProvider)await new Promise(resolve=>h.resolveProvider=resolve);return provider}`,
    "@/lib/m2-studio-protocol":
      "export const studioTicketSchema={parse:(value)=>value}",
    "@/lib/providers/m2-endurance-recorder":
      "export const enduranceStorageKey=()=>'';export class EnduranceRecorder{finish(){}}",
    "@/lib/camera-zoom-command":
      "export const shouldApplyCameraZoomCommand=()=>false",
    "@/lib/camera-audio":
      "export const cameraAudioEnabled=()=>window.__tabCamera.enableAudio",
  };
  const bundle = await build({
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    loader: { ".css": "empty" },
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{M2CameraSlot}from'./src/components/M2CameraSlot';const root=createRoot(document.getElementById('root'));window.__unmountCamera=()=>root.unmount();root.render(<M2CameraSlot id='${game}' side='camera' cameraRole={new URLSearchParams(location.search).get('role')==='away'?'camera-away':'camera-home'}/>);`,
    },
    plugins: [
      {
        name: "camera-tab-fixture",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  await context.addInitScript(() => {
    const track = () => ({
      readyState: "live",
      enabled: true,
      contentHint: "",
      stop() {
        this.readyState = "ended";
      },
      getSettings: () => ({}),
      getCapabilities: () => ({}),
    });
    const h = ((window as any).__tabCamera = {
      captures: 0,
      polls: 0,
      video: track(),
      audio: track(),
      tracks: [] as unknown[],
      providers: [] as unknown[],
      deferProvider: false,
      holdStorageEvents: false,
      enableAudio: false,
      holdPendingAudio: false,
      pendingAudio: 0,
      publishedAudio: [] as unknown[],
      resolvePendingAudio: undefined as undefined | (() => void),
    });
    // Register before the component's owner listener: listeners on window run
    // in registration order, so a later listener cannot hold an earlier one.
    window.addEventListener("storage", (event) => {
      if (h.holdStorageEvents) event.stopImmediatePropagation();
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          h.captures++;
          h.video = track();
          h.audio = track();
          h.tracks.push(h.video, h.audio);
          return { getAudioTracks: () => [h.audio] };
        },
      },
    });
    // Count actual component intent polls independently for each tab.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      if (init?.method === "PATCH" && h.holdPendingAudio) {
        const body = JSON.parse(String(init.body));
        if (body.type === "camera-audio-status" && body.status === "pending") {
          h.pendingAudio++;
          // Ignore abort deliberately: already buffered adapter responses may
          // complete after another tab has acquired ownership.
          return new Promise<Response>((resolve) => {
            h.resolvePendingAudio = () =>
              resolve(new Response("{}", { status: 200 }));
          });
        }
      }
      if (
        /^\/api\/games\/[^/]+$/.test(String(input)) &&
        (!init?.method || init.method === "GET")
      )
        h.polls++;
      return originalFetch(input, init);
    };
  });
  await context.route("**/m2-tab-fixture?*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/m2-tab-fixture.js"></script>',
    }),
  );
  await context.route("**/m2-tab-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await context.route(`**/api/games/${game}/studio-m2`, (route) =>
    route.fulfill({ json: {} }),
  );
  const state: { reconnect?: { id: string; requestedAt: number } } = {};
  await context.route(`**/api/games/${game}`, (route) =>
    route.fulfill({
      json:
        route.request().method() === "GET"
          ? { cameraReconnect: { "camera-home": state.reconnect } }
          : {},
    }),
  );
  return state;
}

async function openCamera(context: BrowserContext, role = "home") {
  const page = await context.newPage();
  await page.clock.install({ time: new Date("2026-10-01T12:00:00Z") });
  // Pause before mounting so interval/timeout races advance only through runFor.
  // The distant fixed target cannot expire during a busy worker's tool calls.
  await page.clock.pauseAt(new Date("2026-10-02T12:00:00Z"));
  await page.goto(`/m2-tab-fixture?role=${role}`);
  return page;
}

async function connect(page: Page, count = 1) {
  await page
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__tabCamera.providers.length),
    )
    .toBe(count);
  await expect(
    page.getByRole("button", { name: "Disconnect phone", exact: true }),
  ).toBeVisible();
}

async function advance(page: Page) {
  // Cross both the 2-second retry delay and several intent polling intervals.
  await page.clock.runFor(6500);
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const h = (window as any).__tabCamera;
    return {
      captures: h.captures,
      stopped: h.providers.map((provider: any) => provider.stopped),
      tracks: h.tracks.map((track: any) => track.readyState),
      polls: h.polls,
    };
  });
}

test("only a deliberate Connect gesture can take the same camera from another tab", async ({
  context,
}) => {
  const state = await fixture(context);
  // These pages deliberately share one BrowserContext and real localStorage.
  const first = await openCamera(context);
  const second = await openCamera(context);
  const away = await openCamera(context, "away");
  await connect(first);
  await connect(away);
  await connect(second);
  await expect(first.getByRole("status")).toContainText(takeoverMessage);
  await expect
    .poll(() => snapshot(first))
    .toMatchObject({
      captures: 1,
      stopped: [1],
      tracks: ["ended", "ended"],
    });
  const retiredPolls = (await snapshot(first)).polls;
  const successorPolls = (await snapshot(second)).polls;
  // A stale provider callback and a fresh organizer recovery command must not
  // revive a tab whose user consent and ownership have been retired.
  await first.evaluate(() =>
    (window as any).__tabCamera.providers[0].onStop("Transient peer failure"),
  );
  state.reconnect = {
    id: "successor-recovery",
    requestedAt: await second.evaluate(() => Date.now()),
  };
  await advance(first);
  await advance(second);
  await expect
    .poll(() => snapshot(second))
    .toMatchObject({
      captures: 2,
      stopped: [1, 0],
      tracks: ["ended", "ended", "live", "live"],
    });
  expect((await snapshot(second)).polls).toBeGreaterThan(successorPolls);
  expect((await snapshot(first)).captures).toBe(1);
  expect((await snapshot(first)).polls).toBe(retiredPolls);
  await expect(first.getByRole("status")).toContainText(takeoverMessage);

  await connect(first, 2);
  await expect(second.getByRole("status")).toContainText(takeoverMessage);
  await expect
    .poll(() => snapshot(second))
    .toMatchObject({
      stopped: [1, 1],
      tracks: ["ended", "ended", "ended", "ended"],
    });
  // Navigation/cleanup in the retired tab must not remove its successor's lease.
  await second.evaluate(() => {
    window.dispatchEvent(new Event("pagehide"));
    (window as any).__unmountCamera();
    (window as any).__tabCamera.providers[1].onStop("Late retired callback");
  });
  await first.evaluate(() =>
    (window as any).__tabCamera.providers[1].onStop("Transient peer failure"),
  );
  await advance(first);
  await expect
    .poll(() => snapshot(first))
    .toMatchObject({
      captures: 3,
      stopped: [1, 1, 0],
    });
  await advance(second);
  expect((await snapshot(second)).captures).toBe(2);
  await advance(away);
  expect(await snapshot(away)).toMatchObject({
    captures: 1,
    stopped: [0],
    tracks: ["live", "live"],
  });
});

test("a retired pending provider cannot release the newer tab when it settles", async ({
  context,
}) => {
  await fixture(context);
  const first = await openCamera(context);
  const second = await openCamera(context);
  await first.evaluate(
    () => ((window as any).__tabCamera.deferProvider = true),
  );
  await first
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await expect
    .poll(() =>
      first.evaluate(() => (window as any).__tabCamera.providers.length),
    )
    .toBe(1);
  await connect(second);
  await expect(first.getByRole("status")).toContainText(takeoverMessage);
  await first.evaluate(() => (window as any).__tabCamera.resolveProvider());
  await expect
    .poll(() => snapshot(first))
    .toMatchObject({
      captures: 1,
      stopped: [1],
      tracks: ["ended", "ended"],
    });
  await first.evaluate(() => (window as any).__unmountCamera());
  await second.evaluate(() =>
    (window as any).__tabCamera.providers[0].onStop("Transient peer failure"),
  );
  await advance(second);
  await expect
    .poll(() => snapshot(second))
    .toMatchObject({
      captures: 2,
      stopped: [1, 0],
      tracks: ["ended", "ended", "live", "live"],
    });
  await advance(first);
  expect((await snapshot(first)).captures).toBe(1);
});

test("disconnect in an old tab cannot remove a successor before its storage event arrives", async ({
  context,
}) => {
  await fixture(context);
  const first = await openCamera(context);
  const second = await openCamera(context);
  await connect(first);
  // Hold notification delivery to expose the interval between another tab's
  // synchronous localStorage acquisition and this tab processing that event.
  // Ownership itself still uses the browser's real shared localStorage.
  await first.evaluate(
    () => ((window as any).__tabCamera.holdStorageEvents = true),
  );
  await connect(second);
  await first
    .getByRole("button", { name: "Disconnect phone", exact: true })
    .click();
  await first.evaluate(() =>
    (window as any).__tabCamera.providers[0].onStop(
      "Late disconnected callback",
    ),
  );
  await second.evaluate(() =>
    (window as any).__tabCamera.providers[0].onStop("Transient peer failure"),
  );
  await advance(second);
  await expect
    .poll(() => snapshot(second))
    .toMatchObject({
      captures: 2,
      stopped: [1, 0],
      tracks: ["ended", "ended", "live", "live"],
    });
  await advance(first);
  expect(await snapshot(first)).toMatchObject({
    captures: 1,
    stopped: [1],
    tracks: ["ended", "ended"],
  });
});

test("late microphone setup cannot acquire or publish audio after another tab takes over", async ({
  context,
}) => {
  await fixture(context);
  const first = await openCamera(context);
  const second = await openCamera(context);
  await connect(first);
  await first.evaluate(() => {
    const h = (window as any).__tabCamera;
    h.holdStorageEvents = true;
    h.holdPendingAudio = true;
    h.enableAudio = true;
    // Force a new microphone acquisition rather than reusing the warm track.
    h.audio.stop();
  });
  await first.clock.runFor(2100);
  await expect
    .poll(() => first.evaluate(() => (window as any).__tabCamera.pendingAudio))
    .toBe(1);
  await connect(second);
  await first.evaluate(async () => {
    (window as any).__tabCamera.resolvePendingAudio();
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  });
  await expect(first.getByRole("status")).toContainText(takeoverMessage);
  await expect
    .poll(() => snapshot(first))
    .toMatchObject({
      captures: 1,
      stopped: [1],
      tracks: ["ended", "ended"],
    });
  expect(
    await first.evaluate(
      () => (window as any).__tabCamera.publishedAudio.length,
    ),
  ).toBe(0);
  await advance(first);
  expect((await snapshot(first)).captures).toBe(1);
  await advance(second);
  expect(await snapshot(second)).toMatchObject({
    captures: 1,
    stopped: [0],
    tracks: ["live", "live"],
  });
});
