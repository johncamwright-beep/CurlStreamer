import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";
import { broadcastGame } from "../src/lib/game-projection";
import { gameFixture } from "../src/test/game-fixture";

const game = broadcastGame(gameFixture());
game.sponsors = [];
const endpoint = `**/api/games/${game.id}/studio-m3`;
const url = `/studio-m3/${game.id}/program`;

test("private OBS source requires authority and shows no public game", async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 401, json: { error: "Unauthorized" } }),
  );
  await page.goto(url);
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Program access ended",
  );
  await expect(page.getByTestId("m3-program-frame")).toHaveCount(0);
  await expect(
    page.getByText(game.config.homeName, { exact: true }),
  ).toHaveCount(0);
});

test("private source exchanges its fragment once, contains frames, and follows saved layout", async ({
  page,
}) => {
  let layout = game.layout;
  const exchanges: unknown[] = [];
  await page.route(endpoint, (route) => {
    const request = route.request();
    if (request.method() === "GET")
      return route.fulfill({ json: { game: { ...game, layout } } });
    const body = request.postDataJSON();
    if (body.action === "exchange") {
      exchanges.push(body);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 409, json: { error: "Unpaired" } });
  });
  await page.goto(`${url}#code=${"a".repeat(43)}`);
  await expect(page.getByTestId("m3-program-frame")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${url}$`));
  expect(exchanges).toEqual([{ action: "exchange", code: "a".repeat(43) }]);
  expect(
    await page.getByTestId("m3-program-frame").evaluate((element) => ({
      width: (element as HTMLElement).offsetWidth,
      height: (element as HTMLElement).offsetHeight,
    })),
  ).toEqual({ width: 1920, height: 1080 });
  await expect(page.getByTestId("camera-deck")).toHaveAttribute(
    "data-camera-count",
    "2",
  );
  await expect(page.getByTestId("broadcast-scoreboard")).toContainText("Rocks");
  for (const label of ["Camera 1 complete frame", "Camera 2 complete frame"]) {
    const video = page.getByLabel(label);
    await expect(video).toHaveCSS("object-fit", "contain");
    await expect(video).toHaveCSS("visibility", "hidden");
    expect(
      await video.evaluate(
        (element) => (element as HTMLVideoElement).srcObject,
      ),
    ).toBeNull();
  }
  layout = "home";
  await expect(page.getByTestId("camera-deck")).toHaveAttribute(
    "data-camera-count",
    "1",
  );
  await expect(page.getByLabel("Camera 2 complete frame")).toHaveCount(0);
});

test("source hides unverified media and reveals the whole frame only after direct verification", async ({
  page,
}) => {
  await page.route(endpoint, (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto(url);
  // Inject the actual component with a synthetic receiver so no signaling or real game is touched.
  const source = path.resolve("src/components/M3Program.tsx");
  const bundle = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {M3Program} from ${JSON.stringify(source)}; const host=document.createElement('div'); document.body.replaceChildren(host); createRoot(host).render(React.createElement(M3Program,{id:${JSON.stringify(game.id)}}));`,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "synthetic-receiver",
        setup(builder) {
          builder.onResolve({ filter: /m3-program-browser$/ }, () => ({
            path: "receiver",
            namespace: "synthetic",
          }));
          builder.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
            contents: `export function startProgramReceiver(options) {
        options.onGame(${JSON.stringify(game)});
        const canvas=document.createElement('canvas'); canvas.width=480; canvas.height=640;
        const context=canvas.getContext('2d'); context.fillStyle='cyan'; context.fillRect(0,0,480,640);
        const stream=canvas.captureStream(1);
        options.onCamera('camera-home',{stream,status:'Verifying direct path'});
        window.__m3Verified=(direct)=>options.onCamera('camera-home',{stream,metrics:{direct},status:direct?'Verified direct':'Verifying direct path'});
        return {stop(){stream.getTracks().forEach(track=>track.stop());}};
      }`,
            loader: "js",
          }));
        },
      },
    ],
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const video = page.getByLabel("Camera 1 complete frame");
  await expect(video).toHaveCSS("visibility", "hidden");
  await expect
    .poll(() =>
      video.evaluate((element) =>
        Boolean((element as HTMLVideoElement).srcObject),
      ),
    )
    .toBe(true);
  await page.evaluate(() =>
    (window as unknown as { __m3Verified(direct: boolean): void }).__m3Verified(
      true,
    ),
  );
  await expect(video).toHaveCSS("visibility", "visible");
  await expect(video).toHaveCSS("object-fit", "contain");
  await page.evaluate(() =>
    (window as unknown as { __m3Verified(direct: boolean): void }).__m3Verified(
      false,
    ),
  );
  await expect(video).toHaveCSS("visibility", "hidden");
});
