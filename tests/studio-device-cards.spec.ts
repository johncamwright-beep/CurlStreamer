import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { testGameId } from "../src/test/game-fixture";
import type { StudioCameraInput } from "../src/components/StudioCameraInputs";
let bundle: string;
let stylesheet: string;
test.beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {StudioDeviceCards} from './src/components/StudioDeviceCards';
        const root = createRoot(document.getElementById('root'));
        window.updateDeviceFixture = (claims, layout) => root.render(
          <StudioDeviceCards id="${testGameId}" enabled claims={claims} layout={layout}
            onChanged={async () => window.updateDeviceFixture({})}
            onLayout={layout ? async (value) => window.updateDeviceFixture(claims, value) : undefined}
          />
        );
        window.updateDeviceFixture({'camera-home':'assigned'});
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    outfile: "fixture.js",
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "fixture-link",
        setup(builder) {
          builder.onResolve({ filter: /^next\/link$/ }, () => ({
            path: "link",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents:
              "export default function Link(props){return <a {...props}/>}",
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  bundle = output.outputFiles.find((file) => file.path.endsWith(".js"))!.text;
  stylesheet = output.outputFiles.find((file) =>
    file.path.endsWith(".css"),
  )!.text;
});
async function openCards(page: Page) {
  await page.route(
    `**/api/games/${testGameId}/camera-reconnect-invitation`,
    (route) =>
      route.fulfill({
        json: {
          url: new URL(
            `/studio-m2/${testGameId}/camera/${route.request().postDataJSON().role}#token=fixture-renewal`,
            route.request().url(),
          ).href,
          expiresAt: new Date(Date.now() + 600_000).toISOString(),
        },
      }),
  );
  await page.route("**/device-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/device-fixture.css"><style>*{box-sizing:border-box}body{font:16px system-ui;background:#071320;margin:0;padding:24px}button{border:0;font:inherit;cursor:pointer}a{text-decoration:none}</style><main id="root"></main><script src="/device-fixture.js"></script>',
    }),
  );
  await page.route("**/device-fixture.js", (route) =>
    route.fulfill({ contentType: "text/javascript", body: bundle }),
  );
  await page.route("**/device-fixture.css", (route) =>
    route.fulfill({ contentType: "text/css", body: stylesheet }),
  );
  await page.goto("/device-fixture");
}

test("IP camera disconnect cancels retries while the eye controls broadcast visibility", async ({
  page,
}, info) => {
  await page.setViewportSize({
    width: info.project.name === "mobile" ? 320 : 768,
    height: 850,
  });
  const commands: string[] = [];
  const source: StudioCameraInput = {
    kind: "tapo",
    configured: true,
    phase: "retrying",
    connectionEnabled: true,
    generation: 2,
  };
  await page.exposeFunction("recordCameraCommand", (action: string) => {
    commands.push(action);
  });
  await page.addInitScript(
    ({ gameId, source }) => {
      const fixture = window as typeof window & {
        chrome: {
          webview: {
            postMessage(message: { action: string; nonce: string }): void;
          };
        };
        recordCameraCommand(action: string): void;
        reportCamera(camera: StudioCameraInput): void;
      };
      fixture.reportCamera = (camera) =>
        window.dispatchEvent(
          new CustomEvent("studio-camera-inputs", {
            detail: { gameId, cameras: { "camera-away": camera } },
          }),
        );
      fixture.chrome = {
        webview: {
          postMessage({ action, nonce }) {
            fixture.recordCameraCommand(action);
            const connectionEnabled = action === "connect-camera";
            source.connectionEnabled = connectionEnabled;
            source.phase = connectionEnabled ? "streaming" : "idle";
            source.generation++;
            fixture.reportCamera(source);
            window.dispatchEvent(
              new CustomEvent("studio-camera-connection-result", {
                detail: {
                  gameId,
                  cameraRole: "camera-away",
                  nonce,
                  ok: true,
                  connectionEnabled,
                  generation: source.generation,
                },
              }),
            );
          },
        },
      };
    },
    { gameId: testGameId, source },
  );
  await openCards(page);
  const card = page.getByRole("region", { name: "Camera 2", exact: true });
  await expect(card).toBeVisible();
  await page.evaluate((camera) => {
    const fixture = window as unknown as {
      updateDeviceFixture(claims: object, layout: string): void;
      reportCamera(camera: StudioCameraInput): void;
    };
    fixture.updateDeviceFixture({ "camera-home": "assigned" }, "split");
    fixture.reportCamera(camera);
  }, source);

  const connect = card.getByRole("button", { name: "Connect", exact: true });
  const disconnect = card.getByRole("button", {
    name: "Disconnect",
    exact: true,
  });
  const eye = card.getByRole("button", {
    name: "Show Camera 2 in broadcast",
  });
  await expect(card.getByRole("status")).toHaveText("Retrying…");
  await expect(disconnect).toBeEnabled();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  const eyeBounds = (await eye.boundingBox())!;
  expect(eyeBounds.height).toBeGreaterThanOrEqual(44);
  expect(eyeBounds.width).toBeGreaterThanOrEqual(44);
  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await expect(disconnect).toBeEnabled();
  expect(commands).toEqual([]);

  await disconnect.click();
  await expect(connect).toBeEnabled();
  await expect(card.getByRole("status")).toHaveText("Ready to connect");
  await connect.click();
  await expect(disconnect).toBeEnabled();
  await expect(card.getByRole("status")).toHaveText("Video ready · Hidden");
  await expect(eye).toHaveAttribute("aria-pressed", "false");
  await eye.click();
  await expect(eye).toHaveAttribute("aria-pressed", "true");
  await expect(card.getByRole("status")).toHaveText(
    "Connected · Waiting for preview",
  );
  expect(
    await card.evaluate((node) => node.scrollWidth <= node.clientWidth),
  ).toBe(true);
  const health = card.getByRole("button", {
    name: "Camera 2 connection details",
  });
  const reportHealth = (generation: number) =>
    page.evaluate(
      ({ gameId, generation }) =>
        window.dispatchEvent(
          new CustomEvent("studio-local-health", {
            detail: {
              gameId,
              cameras: {
                "camera-away": {
                  generation,
                  health: {
                    receivedFps: 20,
                    lastFrameAgeMs: 39,
                    longestGapMs: 200,
                    reconnects: 0,
                    decodedFrames: 150,
                    decodeErrors: 0,
                    processingMs: 2,
                    native: {
                      transport: "udp",
                      decodedFrames: 150,
                      decodeErrors: 0,
                      processingMs: 2,
                    },
                  },
                },
              },
            },
          }),
        ),
      { gameId: testGameId, generation },
    );
  await reportHealth(source.generation);
  await expect(health).toBeDisabled();
  await reportHealth(source.generation + 2);
  await health.click();
  await expect(page.getByText("RTSP over UDP.")).toBeVisible();
  expect(commands).toEqual(["disconnect-camera", "connect-camera"]);
});
test("device QR requests are explicit, role-specific and cleared when claimed", async ({
  page,
}, info) => {
  const roles: string[] = [];
  await page.route(
    "**/api/games/" + testGameId + "/invitations",
    async (route) => {
      roles.push(route.request().postDataJSON().role);
      await route.fulfill({
        json: {
          url: new URL(
            "/join/" + testGameId + "?token=fixture-only",
            route.request().url(),
          ).href,
          expiresAt: new Date(Date.now() + 1800000).toISOString(),
        },
      });
    },
  );
  await openCards(page);
  const camera1 = page.getByRole("region", { name: "Camera 1", exact: true });
  const camera2 = page.getByRole("region", { name: "Camera 2", exact: true });
  const scorer = page.getByRole("region", {
    name: "Remote scorer",
    exact: true,
  });
  await expect(camera1).toContainText("Status unavailable");
  await camera1.getByRole("button", { name: "Show reconnect QR" }).click();
  await expect(
    camera1.getByRole("img", { name: "Camera 1 reconnect QR code" }),
  ).toBeVisible();
  await expect(
    camera1.getByRole("link", { name: "Open reconnect page" }),
  ).toHaveAttribute(
    "href",
    new RegExp(
      "/studio-m2/" + testGameId + "/camera/camera-home#token=fixture-renewal$",
    ),
  );
  expect(roles).toEqual([]);
  await camera1.getByRole("button", { name: "Close", exact: true }).click();
  await camera2.getByRole("button", { name: "Show QR code" }).click();
  await expect(
    camera2.getByRole("img", { name: "Camera 2 join QR code" }),
  ).toBeVisible();
  expect(roles).toEqual(["camera-away"]);
  const joinCode = camera2.getByRole("img", { name: "Camera 2 join QR code" });
  expect((await joinCode.boundingBox())?.width).toBe(176);
  await camera2.getByRole("button", { name: "Enlarge QR code" }).click();
  expect((await joinCode.boundingBox())?.width).toBeGreaterThan(176);
  await camera2.getByRole("button", { name: "Shrink QR code" }).click();
  await camera2.getByRole("button", { name: "Close", exact: true }).click();
  await expect(joinCode).toHaveCount(0);
  await camera2.getByRole("button", { name: "Show QR code" }).click();
  await expect(joinCode).toBeVisible();
  expect(roles).toEqual(["camera-away"]);
  await camera2.getByRole("button", { name: "Close", exact: true }).click();
  await scorer.getByRole("button", { name: "Show QR code" }).click();
  await expect(
    scorer.getByRole("img", { name: "Remote scorer join QR code" }),
  ).toBeVisible();
  expect(roles).toEqual(["camera-away", "scorer"]);
  await page.screenshot({
    path: info.outputPath("device-joining.png"),
    fullPage: true,
  });
  await page.evaluate(() =>
    (
      window as unknown as { updateDeviceFixture(v: unknown): void }
    ).updateDeviceFixture({
      "camera-home": "assigned",
      "camera-away": "new-device",
    }),
  );
  await expect(camera2.getByRole("img")).toHaveCount(0);
  await expect(camera2).toContainText("assignment retained");
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(
    "fixture-only",
  );
});

test("camera cards share a row on a tablet and reconnect QR collapses when online", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.clock.install();
  let online = false;
  await page.route("**/api/games/" + testGameId + "/studio-devices", (route) =>
    route.fulfill({
      json: {
        cameras: {
          "camera-home": { receiverReady: true, phoneOnline: online },
        },
      },
    }),
  );
  await openCards(page);
  const first = page.getByRole("region", { name: "Camera 1", exact: true });
  const second = page.getByRole("region", { name: "Camera 2", exact: true });
  expect((await first.boundingBox())?.y).toBe((await second.boundingBox())?.y);
  await first.getByRole("button", { name: "Show reconnect QR" }).click();
  await expect(first.getByRole("img")).toBeVisible();
  online = true;
  await page.clock.fastForward(15000);
  await expect(first.getByRole("status")).toHaveText(
    "Phone online · Waiting for video",
  );
  await expect(first.getByRole("img")).toBeVisible();
  const recovery = first.getByRole("button", {
    name: "Reconnect camera",
    exact: true,
  });
  await expect(recovery).toBeEnabled();
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-camera-status", {
          detail: { gameId, cameras: { "camera-home": true } },
        }),
      ),
    testGameId,
  );
  await expect(first.getByRole("status")).toHaveText("Receiving video");
  await expect(recovery).toBeDisabled();
  await expect(first.getByRole("img")).toHaveCount(0);
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-camera-status", {
          detail: { gameId, cameras: { "camera-home": false } },
        }),
      ),
    testGameId,
  );
  await expect(recovery).toBeEnabled();
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-camera-status", {
          detail: { gameId, cameras: { "camera-home": true } },
        }),
      ),
    testGameId,
  );
  await expect(recovery).toBeDisabled();
  online = false;
  await page.clock.fastForward(6500);
  await expect(recovery).toBeEnabled();
  await expect(
    first.getByRole("button", { name: "Show reconnect QR" }),
  ).toBeVisible();
  await expect(first.getByRole("img")).toHaveCount(0);
});
test("an expired device QR cannot be reused", async ({ page }) => {
  await page.clock.install();
  await page.route(
    "**/api/games/" + testGameId + "/invitations",
    async (route) => {
      await route.fulfill({
        json: {
          url: new URL(
            "/join/" + testGameId + "?token=fixture-only",
            route.request().url(),
          ).href,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      });
    },
  );
  await openCards(page);
  const card = page.getByRole("region", { name: "Camera 2", exact: true });
  await card.getByRole("button", { name: "Show QR code" }).click();
  await expect(card.getByRole("img")).toBeVisible();
  await page.clock.fastForward(65000);
  await expect(card.getByRole("img")).toHaveCount(0);
  await expect(
    card.getByRole("status").filter({ hasText: "expired" }),
  ).toBeVisible();
});
test("an invitation for another game is rejected without displaying a QR", async ({
  page,
}) => {
  await page.route("**/api/games/" + testGameId + "/invitations", (route) =>
    route.fulfill({
      json: {
        url: new URL(
          "/join/other-game?token=fixture-only",
          route.request().url(),
        ).href,
        expiresAt: new Date(Date.now() + 60000).toISOString(),
      },
    }),
  );
  await openCards(page);
  const card = page.getByRole("region", { name: "Remote scorer", exact: true });
  await card.getByRole("button", { name: "Show QR code" }).click();
  await expect(card.getByRole("alert")).toBeVisible();
  await expect(card.getByRole("img")).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Try again" })).toBeEnabled();
});

test("release stays on the game and requires an explicit confirmation", async ({
  page,
}) => {
  const releases: unknown[] = [];
  await page.route("**/api/games/" + testGameId + "/studio-devices", (r) =>
    r.fulfill({
      json: {
        cameras: { "camera-home": { receiverReady: true, phoneOnline: true } },
      },
    }),
  );
  await page.route("**/api/games/" + testGameId + "/release-camera", (r) => {
    releases.push(r.request().postDataJSON());
    return r.fulfill({ json: { released: true } });
  });
  await openCards(page);
  const card = page.getByRole("region", { name: "Camera 1", exact: true });
  await expect(card.getByRole("status")).toHaveText(
    "Phone online · Waiting for video",
  );
  await page.evaluate(
    (gameId) =>
      window.dispatchEvent(
        new CustomEvent("studio-camera-status", {
          detail: { gameId, cameras: { "camera-home": true } },
        }),
      ),
    testGameId,
  );
  await expect(card.getByRole("status")).toHaveText("Receiving video");
  await expect(
    card.getByRole("button", { name: "Show reconnect QR" }),
  ).toHaveCount(0);
  await expect(card).not.toContainText("Reopen the camera page");
  await card
    .getByRole("button", { name: "Release camera", exact: true })
    .click();
  expect(releases).toEqual([]);
  await card.getByRole("button", { name: "Confirm release" }).click();
  await expect(
    card.getByRole("button", { name: "Show QR code", exact: true }),
  ).toBeVisible();
  expect(releases).toEqual([{ role: "camera-home" }]);
  expect(new URL(page.url()).pathname).toBe("/device-fixture");
});
