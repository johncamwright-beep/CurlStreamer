/** Private MOCK game fixture exercising the actual bundled native video renderer.
 * Root runs npm run build:m4-renderer, then:
 * npm exec vite-node -- scripts/player-celebration-native-preview.ts <private-prepared-head.png>
 * The private photo is injected by Node; it is never copied into public assets.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createM4ProgramBridge } from "../src/lib/providers/m4-program-bridge";
import type { PrivateProgramGame } from "../src/lib/game-projection";
import type { CelebrationCue } from "../src/lib/player-celebrations";
import {
  getCelebrationTemplate,
  type CelebrationTemplateId,
} from "../src/lib/player-celebrations";
const templateId = (process.argv[3] ?? "lightsaber") as CelebrationTemplateId;
const template = getCelebrationTemplate(templateId);
if (!template) throw Error("Unknown celebration template");
let cue: CelebrationCue | undefined;
const organization = "11111111-1111-4111-8111-111111111111";
const head = readFileSync(
  process.argv[2] ?? resolve("work/cameron-starwars/cameron-cutout.png"),
);
const client = {
  close() {},
  sponsorOrganizationId: () => organization,
  async action() {
    return { ok: true as const };
  },
  async readGame(): Promise<PrivateProgramGame> {
    return {
      id: organization,
      config: {
        eventName: "MOCK native video QA",
        homeName: "North",
        awayName: "South",
        homeColor: "#0891b2",
        awayColor: "#dc2626",
      },
      score: { hammer: "home", totals: { home: 4, away: 3 }, currentEnd: 6 },
      layout: "split",
      broadcast: "idle",
      audioMuted: true,
      cameraFraming: { "camera-home": "contain", "camera-away": "contain" },
      sponsors: [],
      sponsorMode: {
        active: false,
        style: "overlay",
        intervalSeconds: 5,
        startedAt: Date.now(),
        rotationOffset: 0,
        paused: false,
      },
      ...(cue ? { celebration: cue } : {}),
    };
  },
};
const realtime = {
  async connect() {
    throw Error("MOCK no camera attached");
  },
  async drain() {
    return [];
  },
  async close() {},
};
const output = resolve(
  "work/celebration-qa/native-video",
  templateId,
  (process.argv[4] ?? "qa").replace(/[^a-z0-9-]/gi, ""),
);
mkdirSync(output, { recursive: true });
const bridge = await createM4ProgramBridge(client, realtime, {
  directory: resolve("public"),
  sponsorStorageOrigin: "https://fixture.supabase.co",
  celebrationFetcher: async () =>
    new Response(head, {
      headers: {
        "content-type": "image/png",
        "content-length": String(head.length),
      },
    }),
});
const browser = await chromium.launch({
  ...(process.platform === "win32" ? { channel: "msedge" } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const state = { sources: 0, plays: 0, peak: 0 };
    Object.assign(window, { celebrationQA: state });
    const create = AudioContext.prototype.createMediaElementSource;
    AudioContext.prototype.createMediaElementSource = function (element) {
      const source = create.call(this, element);
      if (element.hasAttribute("data-celebration-video")) {
        state.sources++;
        const analyser = this.createAnalyser();
        source.connect(analyser);
        const data = new Uint8Array(analyser.fftSize);
        const sample = () => {
          analyser.getByteTimeDomainData(data);
          state.peak = Math.max(
            state.peak,
            ...Array.from(data, (value) => Math.abs(value - 128) / 128),
          );
          requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }
      return source;
    };
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.hasAttribute("data-celebration-video")) state.plays++;
      return play.call(this);
    };
  });
  await page.goto(bridge.rendererUrl);
  await page.getByTestId("broadcast-canvas").waitFor();
  const startedAt = Date.now() + 3500;
  cue = {
    id: crypto.randomUUID(),
    templateId,
    playerId: "private-fixture",
    playerName: "QA Player",
    headshotUrl: `https://fixture.supabase.co/storage/v1/object/sign/celebration-headshots/${organization}/22222222-2222-4222-8222-222222222222.png?token=fixture`,
    startedAt,
    expiresAt: startedAt + template.durationMs,
    muted: false,
    volume: 0.6,
  };
  const scene = page.locator(`[data-celebration="${templateId}"]`);
  await scene.waitFor({ timeout: 10000 }).catch(async (error) => {
    console.log(
      "Native readiness diagnostic",
      await page.evaluate(async () => {
        const video = document.querySelector<HTMLVideoElement>(
          "video[data-celebration-video]",
        );
        const response = await fetch("/program");
        const state = await response.json();
        return {
          video: video
            ? {
                ready: video.readyState,
                network: video.networkState,
                time: video.currentTime,
                duration: video.duration,
                buffered: Array.from(
                  { length: video.buffered.length },
                  (_, i) => [video.buffered.start(i), video.buffered.end(i)],
                ),
                paused: video.paused,
                muted: video.muted,
                status: video.dataset.celebrationStatus,
                failure: video.dataset.celebrationError,
              }
            : null,
          cue: state.game?.celebration
            ? {
                id: state.game.celebration.id,
                head: !!state.game.celebration.headshotUrl,
                start: state.game.celebration.startedAt,
                end: state.game.celebration.expiresAt,
              }
            : null,
          now: Date.now(),
          qa: (window as unknown as { celebrationQA: unknown }).celebrationQA,
        };
      }),
      errors,
    );
    throw error;
  });
  await page.waitForTimeout(1500);
  const playback = await page.evaluate(() => {
    const video = document.querySelector<HTMLVideoElement>(
      "video[data-celebration-video]",
    )!;
    const canvas = document.querySelector<HTMLCanvasElement>(
      "[data-celebration] canvas",
    )!;
    return {
      time: video.currentTime,
      frame: Number(canvas.dataset.frame),
      muted: video.muted,
      ...(
        window as unknown as {
          celebrationQA: { sources: number; plays: number; peak: number };
        }
      ).celebrationQA,
    };
  });
  if (Math.abs(playback.frame - Math.floor(playback.time * 30)) > 2)
    throw Error(`Head/video frame drift: ${JSON.stringify(playback)}`);
  if (
    playback.muted ||
    playback.sources !== 1 ||
    playback.plays !== 1 ||
    playback.peak < 0.001
  )
    throw Error(
      `Native original audio missing/duplicated: ${JSON.stringify(playback)}`,
    );
  await page.screenshot({ path: resolve(output, "playing.png") });
  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const r = document.querySelector(selector)!.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return {
      square: rect("[data-celebration] canvas"),
      deck: rect('[data-testid="camera-deck"]'),
      rail: rect('[data-testid="program-side-rail"]'),
      cameras: document.querySelectorAll('[data-testid^="camera-panel-"]')
        .length,
    };
  });
  const { square, deck, rail } = geometry;
  if (
    geometry.cameras !== 2 ||
    Math.abs(square.width - square.height) > 1 ||
    square.width <= 0 ||
    square.x < deck.x - 1 ||
    square.y < deck.y - 1 ||
    square.x + square.width > deck.x + deck.width + 1 ||
    square.y + square.height > deck.y + deck.height + 1 ||
    square.x + square.width > rail.x + 1
  )
    throw Error(
      `Square overlay escaped camera area: ${JSON.stringify(geometry)}`,
    );
  await scene.waitFor({ state: "hidden", timeout: 12000 });
  const stopped = await page
    .locator("video[data-celebration-video]")
    .evaluate((video) => (video as HTMLVideoElement).paused);
  if (!stopped) throw Error("Video did not stop at expiry");
  await page.reload();
  await page.getByTestId("broadcast-canvas").waitFor();
  await page.waitForTimeout(1200);
  if (await scene.count())
    throw Error("Expired cue replayed after native reconnect");
  // A cue first received beyond the bounded start window must never play.
  const staleStart = Date.now() - 2000;
  cue = {
    ...cue,
    id: crypto.randomUUID(),
    startedAt: staleStart,
    expiresAt: staleStart + template.durationMs,
  };
  await page.waitForTimeout(2200);
  if (await scene.count()) throw Error("Stale cue played");
  // A new cue is allowed, and clearing it stops both video and visibility.
  const restart = Date.now() + 2500;
  cue = {
    ...cue,
    id: crypto.randomUUID(),
    startedAt: restart,
    expiresAt: restart + template.durationMs,
  };
  await scene.waitFor({ timeout: 6000 });
  await page.waitForTimeout(350);
  cue = undefined;
  await scene.waitFor({ state: "hidden", timeout: 2500 });
  const stopState = await page
    .locator("video[data-celebration-video]")
    .evaluate((video) => ({
      paused: (video as HTMLVideoElement).paused,
      muted: (video as HTMLVideoElement).muted,
    }));
  if (!stopState.paused || !stopState.muted)
    throw Error("Stop did not silence/pause video");
  const activeReload = Date.now() + 2500;
  cue = {
    id: crypto.randomUUID(),
    templateId,
    playerId: "private-fixture",
    playerName: "QA Player",
    headshotUrl: `https://fixture.supabase.co/storage/v1/object/sign/celebration-headshots/${organization}/22222222-2222-4222-8222-222222222222.png?token=fixture`,
    startedAt: activeReload,
    expiresAt: activeReload + template.durationMs,
    muted: false,
    volume: 0.6,
  };
  await scene.waitFor({ timeout: 6000 });
  await page.reload();
  await page.getByTestId("broadcast-canvas").waitFor();
  await page.waitForTimeout(1200);
  if (await scene.count()) throw Error("Active cue replayed after reload");
  if (errors.length) throw Error(errors.join("; "));
  console.log(
    JSON.stringify(
      {
        nativeVideo: "passed",
        ...playback,
        expired: true,
        noReconnectReplay: true,
        noActiveReloadReplay: true,
        staleRejected: true,
        stopSilenced: true,
        templateId,
        squareWithinCameraDeck: true,
        screenshot: resolve(output, "playing.png"),
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await bridge.close();
}
