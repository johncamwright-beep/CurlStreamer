import { expect, test } from "@playwright/test";
import { build } from "esbuild";

const game = "00000000-0000-4000-8000-000000000001";

test("M2 phone retains one permissioned microphone through intent polls and status telemetry failure", async ({
  page,
}) => {
  test.slow();
  let enabled = false;
  const mocks: Record<string, string> = {
    qrcode: "export default {toDataURL: async()=>''}",
    "next/image": "export default function Image(){return null}",
    "@/lib/access-session": `export const cameraPublishAccessToken=()=>"phone-token";export const organizerAccessToken=()=>"organizer-token";export const preserveAndStoreParticipantAccess=()=>{}`,
    "@/lib/providers/livekit-client": `export const hardwareZoomRange=()=>undefined;export const clampZoom=(value)=>value`,
    "@/lib/providers/camera-capture": `export const deviceIsPortrait=()=>true;export async function acquireRawPortraitCamera(_devices,_video,_portrait,onTrack,_mode,includeAudio){await navigator.mediaDevices.getUserMedia({audio:includeAudio,video:true});const h=window.__m2PhoneAudio;onTrack?.(h.video);return {track:h.video,audioTrack:includeAudio?h.audio:undefined,report:{}}}`,
    "@/lib/providers/screen-wake-lock":
      "export class OptionalScreenWakeLock{start(){} async release(){}}",
    "@/lib/providers/m2-studio-browser": `export async function connectStudio(){const h=window.__m2PhoneAudio;return {stop(){h.stopped++},async replaceAudioTrack(track){h.replaced.push(track)}}}`,
    "@/lib/m2-studio-protocol": `export const studioTicketSchema={parse:(value)=>value}`,
    "@/lib/providers/m2-endurance-recorder": `export const enduranceStorageKey=()=>"test";export class EnduranceRecorder{finish(){}}`,
    "@/lib/camera-zoom-command":
      "export const shouldApplyCameraZoomCommand=()=>false",
    "@/lib/camera-audio": `export const cameraAudioEnabled=(game,role)=>game.cameraAudio?.[role]?.enabled===true`,
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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{M2CameraSlot}from'./src/components/M2CameraSlot';createRoot(document.getElementById('root')).render(<M2CameraSlot id='${game}' side='camera' cameraRole='camera-home'/>);`,
    },
    plugins: [
      {
        name: "m2-phone-audio-mocks",
        setup(build) {
          build.onResolve({ filter: /.*/ }, (args) => {
            if (mocks[args.path]) return { path: args.path, namespace: "mock" };
          });
          build.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  await page.addInitScript(() => {
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
    (
      window as typeof window & { __m2PhoneAudio: Record<string, unknown> }
    ).__m2PhoneAudio = {
      calls: [] as MediaStreamConstraints[],
      video: track(),
      audio: track(),
      replaced: [] as Array<MediaStreamTrack | null>,
      stopped: 0,
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          const h = (
            window as typeof window & {
              __m2PhoneAudio: {
                calls: MediaStreamConstraints[];
                audio: MediaStreamTrack;
              };
            }
          ).__m2PhoneAudio;
          h.calls.push(constraints);
          return { getAudioTracks: () => [h.audio] };
        },
      },
    });
  });
  await page.route("**/m2-phone-audio-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/m2-phone-audio-fixture.js"></script>',
    }),
  );
  await page.route("**/m2-phone-audio-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route(`**/api/games/${game}/studio-m2`, (route) =>
    route.fulfill({
      json: {
        cameraRole: "camera-home",
        sessionId: "00000000-0000-4000-8000-000000000002",
        negotiationId: "00000000-0000-4000-8000-000000000003",
        generation: 1,
        assignmentGeneration: 1,
        expiresAt: Date.now() + 20_000,
      },
    }),
  );
  await page.route(`**/api/games/${game}`, async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({
        json: { cameraAudio: { "camera-home": { enabled } } },
      });
    const body = route.request().postDataJSON();
    // The sender has already accepted the track when this telemetry request is made.
    if (body.type === "camera-audio-status" && body.status === "active")
      return route.fulfill({
        status: 500,
        json: { error: "telemetry unavailable" },
      });
    return route.fulfill({ json: {} });
  });

  await page.goto("/m2-phone-audio-fixture");
  await page
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const h = (window as any).__m2PhoneAudio;
        return {
          calls: h.calls.length,
          enabled: h.audio.enabled,
          ready: h.audio.readyState,
          attachments: h.replaced.length,
        };
      }),
    )
    .toEqual({ calls: 1, enabled: false, ready: "live", attachments: 0 });
  enabled = true;
  await page.waitForFunction(() => {
    const h = (
      window as typeof window & { __m2PhoneAudio: { replaced: unknown[] } }
    ).__m2PhoneAudio;
    return h.replaced.length === 1;
  });
  // Two further intent polls must retain the published track, despite failed status telemetry.
  await page.waitForTimeout(4_300);
  const state = await page.evaluate(() => {
    const h = (
      window as typeof window & {
        __m2PhoneAudio: {
          calls: MediaStreamConstraints[];
          audio: MediaStreamTrack;
          replaced: unknown[];
        };
      }
    ).__m2PhoneAudio;
    return {
      calls: h.calls,
      audioState: h.audio.readyState,
      enabled: h.audio.enabled,
      replacements: h.replaced.length,
    };
  });
  expect(state.calls).toEqual([
    expect.objectContaining({ audio: true, video: true }),
  ]);
  expect(state.replacements).toBe(1);
  expect(state.audioState).toBe("live");
  expect(state.enabled).toBe(true);
  enabled = false;
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__m2PhoneAudio.audio.enabled),
    )
    .toBe(false);
  enabled = true;
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__m2PhoneAudio.audio.enabled),
    )
    .toBe(true);
  expect(
    await page.evaluate(() => (window as any).__m2PhoneAudio.calls.length),
  ).toBe(1);
});
