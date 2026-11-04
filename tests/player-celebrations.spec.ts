import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import sharp from "sharp";

test("a cold preview waits for assets and then plays from the beginning", async ({
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
    import React from 'react';import {createRoot} from 'react-dom/client';import {PlayerCelebration} from './src/components/PlayerCelebration';
    const now=Date.now();createRoot(document.getElementById('root')).render(<PlayerCelebration startWhenReady cue={{id:'cold-preview',templateId:'cat-dance',playerId:'mock',playerName:'MOCK',headshotUrl:'/cold-head.png',startedAt:now+2500,expiresAt:now+12200,volume:.5,muted:false}}/>);
  `,
    },
  });
  const head = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: { r: 255, g: 180, b: 80, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  await page.route("**/cold-head.png", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 4500));
    await route.fulfill({ contentType: "image/png", body: head });
  });
  await page.route("**/celebrations/cat-dance.mp4", async (route) =>
    route.fulfill({
      contentType: "video/mp4",
      body: await readFile("public/celebrations/cat-dance.mp4"),
    }),
  );
  await page.route("**/cold-preview.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route("**/cold-preview", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root" style="position:relative;width:320px;height:320px"></div><script src="/cold-preview.js"></script>',
    }),
  );
  await page.goto("/cold-preview");
  await expect(page.getByRole("img", { name: "MOCK: Cat Dance" })).toBeVisible({
    timeout: 12000,
  });
  const video = page.locator("video[data-celebration-video]");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.1);
  expect(
    await video.evaluate((v: HTMLVideoElement) => ({
      time: v.currentTime,
      muted: v.muted,
      paused: v.paused,
    })),
  ).toMatchObject({ muted: true, paused: false });
  expect(
    await video.evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeLessThan(2);
});

for (const templateId of ["lightsaber", "cat-dance", "trump-dance"]) {
  test(`Studio ${templateId} previews silently, plays, stops and recovers roster loading at mobile width`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.clock.install();
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
    import React from 'react';import {createRoot} from 'react-dom/client';import {StudioCelebrations} from './src/components/StudioCelebrations';import {gameFixture} from './src/test/game-fixture';
    window.calls=[];window.rejectPlay=false;window.audioContexts=0;const NativeAudio=window.AudioContext;window.AudioContext=class extends NativeAudio{constructor(...args){super(...args);window.audioContexts++;}};
    createRoot(document.getElementById('root')).render(<StudioCelebrations displayMode="dialog" game={gameFixture()} act={async action=>{if(window.rejectPlay)throw Error('Rejected');window.calls.push(action)}}/>);
  `,
      },
    });
    let failing = true;
    let successfulLoads = 0;
    let requestedHead = "";
    await page.route("**/test-head.png?version=*", (route) => {
      requestedHead = route.request().url();
      return route.fulfill({ status: 404 });
    });
    await page.route("**/api/celebrations/headshots?gameId=*", (route) =>
      failing
        ? route.fulfill(
            templateId === "cat-dance"
              ? { json: {} }
              : { status: 503, json: { error: "unavailable" } },
          )
        : (successfulLoads++,
          route.fulfill({
            json: {
              players: [{ id: "player-1", name: "Sam", position: "skip" }],
              headshots: [
                {
                  id: "photo-1",
                  rosterPlayerId: "player-1",
                  playerName: "Sam",
                  imageUrl: "/test-head.png?version=" + successfulLoads,
                },
              ],
              canEdit: false,
            },
          })),
    );
    await page.route("**/celebrations-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:8px}button,select,summary{min-height:44px}section>div{display:flex;flex-wrap:wrap;gap:12px}label{max-width:100%}select{display:block;max-width:100%}.relative{position:relative}.aspect-video{aspect-ratio:16/9}.overflow-hidden{overflow:hidden}</style><div id="root"></div><script src="/celebrations-fixture.js"></script>',
      }),
    );
    await page.route("**/celebrations-fixture.js", (route) =>
      route.fulfill({
        contentType: "text/javascript",
        body: bundle.outputFiles[0].text,
      }),
    );
    await page.goto("/celebrations-fixture");
    await page.getByText("Celebrations", { exact: true }).first().click();
    await expect(page.getByRole("alert").first()).toContainText(
      "could not be loaded",
    );
    failing = false;
    await page.getByRole("button", { name: "Retry player photos" }).click();
    await page.getByLabel("Player", { exact: true }).selectOption("player-1");
    await page
      .getByLabel("Celebration", { exact: true })
      .selectOption(templateId);
    const previousLoads = successfulLoads;
    await page.clock.fastForward("05:01");
    await expect.poll(() => successfulLoads).toBeGreaterThan(previousLoads);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect
      .poll(() => requestedHead)
      .toContain("?version=" + successfulLoads);
    await expect(page.getByLabel("Celebration preview")).toBeVisible();
    expect(await page.evaluate(() => (window as any).calls)).toEqual([]);
    expect(await page.evaluate(() => (window as any).audioContexts)).toBe(0);
    await page.evaluate(() => ((window as any).rejectPlay = true));
    await page.getByRole("button", { name: "Play on stream" }).click();
    await expect(
      page.getByRole("dialog", { name: "Celebrations", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("alert").first()).toContainText(
      "could not be updated",
    );
    await page.evaluate(() => ((window as any).rejectPlay = false));
    await page.getByRole("button", { name: "Play on stream" }).click();
    await expect(
      page.getByRole("dialog", { name: "Celebrations", exact: true }),
    ).not.toBeVisible();
    const actions = await page.evaluate(() => (window as any).calls);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      type: "celebration-play",
      playerId: "player-1",
      templateId,
    });
    expect(actions[0].triggerId).toMatch(/^[a-f0-9-]{36}$/);
    expect(actions[0]).not.toHaveProperty("headshotUrl");
    await expect(page.getByLabel("Celebration preview")).toHaveCount(0);
    await page.getByText("Celebrations", { exact: true }).first().click();
    await page.getByRole("button", { name: "Stop", exact: true }).click();
    expect(await page.evaluate(() => (window as any).calls[1].type)).toBe(
      "celebration-stop",
    );
    await expect(page.getByLabel("Celebration preview")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  });
}

test("game switches clear preview and ignore the previous game's delayed roster", async ({
  page,
}) => {
  const first = "11111111-1111-4111-8111-111111111111";
  const second = "22222222-2222-4222-8222-222222222222";
  const third = "33333333-3333-4333-8333-333333333333";
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
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {StudioCelebrations} from './src/components/StudioCelebrations';import {gameFixture} from './src/test/game-fixture';
    function Harness(){const [id,setId]=useState('${first}');window.switchGame=(value='${second}')=>setId(value);return <StudioCelebrations game={{...gameFixture(),id}} act={async()=>{}}/>;}createRoot(document.getElementById('root')).render(<Harness/>);
  `,
    },
  });
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/celebrations/headshots?gameId=*", async (route) => {
    const old =
      new URL(route.request().url()).searchParams.get("gameId") === first;
    if (old) await delayed;
    const thirdGame =
      new URL(route.request().url()).searchParams.get("gameId") === third;
    await route.fulfill({
      json: {
        players: [
          {
            id: old ? "old-player" : thirdGame ? "third-player" : "new-player",
            name: old
              ? "Old roster"
              : thirdGame
                ? "Third roster"
                : "New roster",
            position: "skip",
          },
        ],
        headshots: [
          {
            id: "photo-new",
            rosterPlayerId: thirdGame ? "third-player" : "new-player",
            playerName: "Player",
            imageUrl: "/test-head.png",
          },
        ],
        canEdit: false,
      },
    });
  });
  await page.route("**/celebrations-race", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/celebrations-race.js"></script>',
    }),
  );
  await page.route("**/celebrations-race.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/celebrations-race");
  await page.getByText("Celebrations", { exact: true }).first().click();
  await expect(
    page.getByRole("button", { name: "Preview", exact: true }),
  ).toBeDisabled();
  await page.evaluate(() => (window as any).switchGame());
  await page.getByLabel("Player", { exact: true }).selectOption("new-player");
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await expect(page.getByLabel("Celebration preview")).toHaveCount(1);
  await page.evaluate((id) => (window as any).switchGame(id), third);
  await expect(page.getByLabel("Celebration preview")).toHaveCount(0);
  await page.getByLabel("Player", { exact: true }).selectOption("third-player");
  const oldResponse = page.waitForResponse((response) =>
    response.url().includes("gameId=" + first),
  );
  release();
  await oldResponse;
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  await expect(page.getByLabel("Player", { exact: true })).toHaveValue(
    "third-player",
  );
  await expect(
    page.getByLabel("Player", { exact: true }).locator("option"),
  ).toHaveText(["Choose player", "Third roster"]);
});

test("native Studio tools share one compact row and open their own panels", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const css = await readFile("src/app/score/[id]/scoring.css", "utf8");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "userAgent", {
      value: "CurlStreamerStudio/0.3 StudioReplay/1",
    }),
  );
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
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {StudioToolsRow} from './src/components/StudioToolsRow';import {StudioReplay} from './src/components/StudioReplay';import {StudioCelebrations} from './src/components/StudioCelebrations';import {StudioOverlay} from './src/components/StudioOverlay';import {gameFixture} from './src/test/game-fixture';
    window.calls=[];window.chrome={webview:{postMessage:m=>window.calls.push(m)}};
    function Tools(){const [open,setOpen]=useState(false);return <><StudioToolsRow cameraSettings={<button onClick={()=>setOpen(true)}>Camera Settings</button>} replay={<StudioReplay gameId="game-1"/>} celebrations={<StudioCelebrations game={gameFixture()} act={async()=>{}} displayMode="dialog"/>}/><StudioOverlay title="Camera Settings" open={open} onClose={()=>setOpen(false)}><button>Camera adjustment</button></StudioOverlay></>;}createRoot(document.getElementById('root')).render(<Tools/>);
  `,
    },
  });
  await page.route("**/api/celebrations/headshots?gameId=*", (route) =>
    route.fulfill({ json: { players: [], headshots: [], canEdit: false } }),
  );
  await page.route("**/tools-row", (route) =>
    route.fulfill({
      contentType: "text/html",
      body:
        '<meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
        css +
        '</style><div id="root"></div><script src="/tools-row.js"></script>',
    }),
  );
  await page.route("**/tools-row.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/tools-row");
  const buttons = page
    .getByRole("group", { name: "Studio tools" })
    .locator(":scope > button");
  await expect(buttons).toHaveText([
    "Camera Settings",
    "Replay",
    "Celebrations",
  ]);
  const boxes = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, height: r.height };
    }),
  );
  expect(new Set(boxes.map((box) => box.y)).size).toBe(1);
  for (const box of boxes) expect(box.height).toBeGreaterThanOrEqual(44);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  expect(boxes[1].x).toBeLessThan(boxes[2].x);
  await page
    .getByRole("button", { name: "Camera Settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Camera Settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Celebrations", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Celebrations" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Celebration", { exact: true }).locator("option"),
  ).toHaveText(["Lightsaber", "Cat Dance", "Trump Dance"]);
  await expect(
    page.getByRole("button", { name: "Play on stream" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-session-status", {
        detail: {
          gameId: "game-1",
          active: true,
          replay: { state: 1, durationMs: 0, availableMs: 60000, clipId: null },
        },
      }),
    ),
  );
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Choose replay start" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
