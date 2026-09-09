import { build } from "esbuild";
import { expect, test, type Page } from "@playwright/test";
import { testGameId } from "../src/test/game-fixture";
let bundle: string;
let stylesheet: string;
test.beforeAll(async () => {
  const output = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {StudioDeviceCards} from './src/components/StudioDeviceCards'; const root=createRoot(document.getElementById('root')); window.updateDeviceFixture=(claims)=>root.render(React.createElement(StudioDeviceCards,{id:'${testGameId}',enabled:true,claims,onChanged:async()=>window.updateDeviceFixture({})})); window.updateDeviceFixture({'camera-home':'assigned'});`,
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
    new RegExp("/studio-m2/" + testGameId + "/camera/camera-home$"),
  );
  expect(roles).toEqual([]);
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
  await camera2.getByRole("button", { name: "Hide QR code" }).click();
  await expect(joinCode).toHaveCount(0);
  await camera2.getByRole("button", { name: "Show QR code" }).click();
  await expect(joinCode).toBeVisible();
  expect(roles).toEqual(["camera-away"]);
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
  await page.clock.fastForward(5000);
  await expect(first.getByRole("status")).toHaveText("Phone connected");
  await expect(first.getByRole("img")).toHaveCount(0);
  online = false;
  await page.clock.fastForward(5000);
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
  await expect(card.getByRole("status")).toHaveText("Phone connected");
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
