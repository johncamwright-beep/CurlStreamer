import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";

const game = "00000000-0000-4000-8000-000000000001";

async function fixture(page: Page, mode: "claim" | "permission" | "receiver") {
  const mocks: Record<string, string> = {
    qrcode: "export default {toDataURL:async()=>''}",
    "next/image": "export default function Image(){return null}",
    "@/lib/access-session": `export const cameraPublishAccessToken=()=>window.__coordinator.stored.at(-1)||'saved-access';export const organizerAccessToken=()=>'';export const preserveAndStoreParticipantAccess=(_storage,_id,token)=>window.__coordinator.stored.push(token)`,
    "@/lib/providers/livekit-client":
      "export const hardwareZoomRange=()=>undefined;export const clampZoom=(value)=>value",
    "@/lib/providers/camera-capture": `export const deviceIsPortrait=()=>true;export async function acquireRawPortraitCamera(_devices,_video,_portrait,onTrack,_mode,includeAudio){const h=window.__coordinator;h.captureCalls.push(includeAudio);try{await navigator.mediaDevices.getUserMedia({audio:includeAudio,video:true});throw new DOMException('Fixture has no camera','NotFoundError')}finally{h.captureSettled++}}`,
    "@/lib/providers/m2-studio-browser":
      "export async function connectStudio(options){const h=window.__coordinator;if(h.mode!=='receiver')throw Error('Capture should not publish in this fixture');h.connected++;options.onMetrics({direct:true,relayBytes:0,framesDecoded:1,bytesReceived:1});return {stop(){h.stopped++},async replaceAudioTrack(){}}}",
    "@/lib/m2-studio-protocol":
      "export const studioTicketSchema={parse:(value)=>value}",
    "@/lib/providers/m2-endurance-recorder":
      "export const enduranceStorageKey=()=>'';export class EnduranceRecorder{finish(){}}",
    "@/lib/camera-zoom-command":
      "export const shouldApplyCameraZoomCommand=()=>false",
    "@/lib/camera-audio": "export const cameraAudioEnabled=()=>false",
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
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{M2CameraSlot}from'./src/components/M2CameraSlot';createRoot(document.getElementById('root')).render(<M2CameraSlot id='${game}' side='${mode === "receiver" ? "receiver" : "camera"}' cameraRole='camera-home'/>);`,
    },
    plugins: [
      {
        name: "coordinator-fixture",
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
  await page.addInitScript(
    ({ mode }) => {
      const h = ((window as any).__coordinator = {
        mode,
        connected: 0,
        stopped: 0,
        checks: [] as Array<(response: Response) => void>,
        claims: [] as Array<{
          token: string;
          resolve: (response: Response) => void;
        }>,
        stored: [] as string[],
        captureCalls: [] as boolean[],
        captureSettled: 0,
        deny: undefined as undefined | (() => void),
      });
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (mode === "receiver" && String(input).endsWith("/studio-m2")) {
          const body = JSON.parse(String(init?.body));
          if (body.action === "check")
            return new Promise<Response>((resolve) => h.checks.push(resolve));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                cameraRole: "camera-home",
                sessionId: "00000000-0000-4000-8000-000000000002",
                negotiationId: "00000000-0000-4000-8000-000000000003",
                generation: 1,
                assignmentGeneration: 1,
                expiresAt: Date.now() + 30_000,
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (String(input).endsWith("/claim")) {
          // Deliberately ignore abort: a completion already buffered by a browser
          // or adapter must still be unable to overwrite the new invitation.
          return new Promise<Response>((resolve) =>
            h.claims.push({
              token: JSON.parse(String(init?.body)).token,
              resolve,
            }),
          );
        }
        return original(input, init);
      };
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () =>
            mode === "permission"
              ? new Promise((_resolve, reject) => {
                  h.deny = () =>
                    reject(
                      new DOMException(
                        "Denied after cancellation",
                        "NotAllowedError",
                      ),
                    );
                })
              : Promise.reject(
                  new DOMException("Fixture has no camera", "NotFoundError"),
                ),
        },
      });
    },
    { mode },
  );
  await page.route("**/m2-coordinator-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/m2-coordinator-fixture.js"></script>',
    }),
  );
  await page.route("**/m2-coordinator-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route(`**/api/games/${game}`, (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto(
    `/m2-coordinator-fixture${mode === "claim" ? "#token=old-invitation" : ""}`,
  );
}

test("cancelled pending claim cannot overwrite a new invitation or start capture", async ({
  page,
}) => {
  await fixture(page, "claim");
  await page
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__coordinator.claims.length),
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Cancel connection", exact: true })
    .click();
  await page.evaluate(() => {
    location.hash = "token=new-invitation";
  });
  await expect(page.getByRole("status")).toContainText(
    "New invitation received",
  );
  await page
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await page.evaluate(() =>
    (window as any).__coordinator.claims[0].resolve(
      new Response(
        JSON.stringify({ role: "camera-home", sessionToken: "old-access" }),
        { headers: { "content-type": "application/json" } },
      ),
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__coordinator.claims.length),
    )
    .toBe(2);
  expect(
    await page.evaluate(() => {
      const h = (window as any).__coordinator;
      return {
        stored: h.stored,
        captures: h.captureCalls,
        token: h.claims[1].token,
      };
    }),
  ).toEqual({ stored: [], captures: [], token: "new-invitation" });
  await page.evaluate(() =>
    (window as any).__coordinator.claims[1].resolve(
      new Response(
        JSON.stringify({ role: "camera-home", sessionToken: "new-access" }),
        { headers: { "content-type": "application/json" } },
      ),
    ),
  );
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__coordinator.captureSettled),
    )
    .toBe(1);
  expect(
    await page.evaluate(() => (window as any).__coordinator.stored),
  ).toEqual(["new-access"]);
});

test("denying a cancelled permission request cannot trigger video-only fallback", async ({
  page,
}) => {
  await fixture(page, "permission");
  await page
    .getByRole("button", { name: "Connect phone", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__coordinator.captureCalls))
    .toEqual([true]);
  await page
    .getByRole("button", { name: "Cancel connection", exact: true })
    .click();
  await page.evaluate(() => (window as any).__coordinator.deny());
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__coordinator.captureSettled),
    )
    .toBe(1);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  expect(
    await page.evaluate(() => (window as any).__coordinator.captureCalls),
  ).toEqual([true]);
  await expect(
    page.getByRole("button", { name: "Connect phone", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("status")).toContainText("Phone disconnected");
});

test("a pending receiver heartbeat cannot invalidate a newly connected handle", async ({
  page,
}) => {
  await page.clock.install();
  await fixture(page, "receiver");
  await page.getByRole("button", { name: "Register PC", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Connect receiver", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(5000);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__coordinator.checks.length),
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "Connect receiver", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => (window as any).__coordinator.connected))
    .toBe(1);
  await page.evaluate(async () => {
    (window as any).__coordinator.checks[0](
      new Response(JSON.stringify({}), {
        headers: { "content-type": "application/json" },
      }),
    );
    // Flush the old response, JSON parsing, stale-epoch rejection and heartbeat catch.
    for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  });
  await page.clock.runFor(50);
  expect(await page.evaluate(() => (window as any).__coordinator.stopped)).toBe(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Create camera invitation", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Connect receiver", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("status").filter({ hasText: "Connected to Studio" }),
  ).toBeVisible();
});
