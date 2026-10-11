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
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {ProgramDelayedVideo} from './src/components/ProgramDelayedVideo';
        import {M4IpCameraTransport} from './src/lib/providers/m4-ip-camera-browser';
        const source=document.createElement('canvas');
        source.width=90; source.height=160;
        const sourceContext=source.getContext('2d');
        window.proof={color:'red',observations:0,firstPaint:0,aspect:0};
        const nativeDecode=window.createImageBitmap.bind(window);
        const stalled=[];
        window.createImageBitmap=(...args)=>window.proof.failMode==='reject'
          ? Promise.reject(new Error('Fixture decode failure'))
          : window.proof.failMode==='stall'
            ? new Promise(resolve=>stalled.push(()=>nativeDecode(...args).then(resolve)))
            : nativeDecode(...args);
        window.releaseDecoder=()=>{window.proof.failMode=undefined;stalled.splice(0).forEach(release=>release())};
        const draw=()=>{sourceContext.fillStyle=window.proof.color;sourceContext.fillRect(0,0,90,160)};
        draw(); setInterval(draw,30);
        let stream=source.captureStream(30);
        const root=createRoot(document.getElementById('root'));
        const nativeFetch=window.fetch.bind(window);
        let counter=0;
        window.fetch=async (url,options)=>{
          if(String(url).startsWith('/ip-camera/')) {
            const blob=await new Promise(resolve=>source.toBlob(resolve,'image/jpeg'));
            return new Response(blob,{headers:{'content-type':'image/jpeg','content-length':String(blob.size),'x-m4-ip-camera-generation':String(window.proof.generation),'x-m4-ip-camera-frame':String(++counter)}});
          }
          if(url==='/camera'){
            window.proof.observations++;
            window.proof.lastVerified=JSON.parse(options.body).verified;
            return new Response('{}');
          }
          return nativeFetch(url,options);
        };
        const receive=(role,state)=>{
          window.proof.message=state.message;
          const host=document.getElementById('ip');
          host.replaceChildren(...(state.canvas?[state.canvas]:[]));
          if(state.canvas&&!window.proof.firstPaint)window.proof.firstPaint=performance.now();
        };
        window.mount=(kind,delay,generation=1)=>{
          window.proof.started=performance.now();
          window.proof.firstPaint=0;window.proof.generation=generation;
          root.render(kind==='phone'
            ? <ProgramDelayedVideo stream={stream} delayMs={delay} onAspect={aspect=>window.proof.aspect=aspect}/>
            : <M4IpCameraTransport role='camera-home' sourceIdentity={'tapo:'+generation} generation={generation} delayMs={delay} onChange={receive}/>);
        };
        window.replacePhone=()=>{stream=source.captureStream(30);window.mount('phone',700)};
        window.pixel=()=>{
          const canvas=document.querySelector('#root canvas')||document.querySelector('#ip canvas');
          return canvas?Array.from(canvas.getContext('2d').getImageData(20,20,1,1).data):[0,0,0,0];
        };
      `,
    },
  });
  await page.route("**/video-delay-proof", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<style>.portrait-camera-video{position:absolute;width:180px;height:320px}</style><div id="root"></div><div id="ip"></div><script src="/video-delay-proof.js"></script>',
    }),
  );
  await page.route("**/video-delay-proof.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/video-delay-proof");
});

test("IP and USB JPEG path presents actual delayed pixels while observations stay live", async ({
  page,
}) => {
  const proof = await page.evaluate(async () => {
    const fixture = window as any;
    fixture.mount("ip", 500);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return { pixel: fixture.pixel(), observations: fixture.proof.observations };
  });
  expect(proof.pixel[3]).toBe(0);
  expect(proof.observations).toBeGreaterThan(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).pixel()[0]))
    .toBeGreaterThan(200);
  expect(
    await page.evaluate(
      () => (window as any).proof.firstPaint - (window as any).proof.started,
    ),
  ).toBeGreaterThanOrEqual(500);
  await page.evaluate(() => {
    const fixture = window as any;
    fixture.proof.color = "blue";
    fixture.mount("ip", 500, 2);
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).pixel()[2]))
    .toBeGreaterThan(200);
  expect(
    await page.evaluate(
      () => (window as any).proof.firstPaint - (window as any).proof.started,
    ),
  ).toBeGreaterThanOrEqual(500);
  expect(
    await page
      .locator("#ip canvas")
      .evaluate((canvas) => getComputedStyle(canvas).objectFit),
  ).toBe("contain");
});

for (const failure of ["reject", "stall"]) {
  test(`continuing JPEG receipt cannot keep failed ${failure} decoding verified`, async ({
    page,
  }) => {
    await page.evaluate(() => (window as any).mount("ip", 250));
    await expect
      .poll(() => page.evaluate(() => (window as any).pixel()[0]))
      .toBeGreaterThan(200);
    await expect
      .poll(() => page.evaluate(() => (window as any).proof.lastVerified))
      .toBe(true);
    const before = await page.evaluate((mode) => {
      const fixture = window as any;
      fixture.proof.failMode = mode;
      return fixture.proof.observations;
    }, failure);
    await expect(page.locator("#ip canvas")).toHaveCount(0, { timeout: 8000 });
    await expect
      .poll(() => page.evaluate(() => (window as any).proof.lastVerified))
      .toBe(false);
    const failed = await page.evaluate(() => ({
      message: (window as any).proof.message,
      observations: (window as any).proof.observations,
    }));
    expect(failed.message).toBe("Reconnecting IP camera…");
    expect(failed.observations).toBeGreaterThan(before);
    await page.evaluate(() => (window as any).releaseDecoder());
    await expect
      .poll(() => page.evaluate(() => (window as any).pixel()[0]))
      .toBeGreaterThan(200);
    await expect
      .poll(() => page.evaluate(() => (window as any).proof.lastVerified))
      .toBe(true);
  });
}

test("phone MediaStream uses delayed complete portrait pixels and clears on adjustment", async ({
  page,
}) => {
  const early = await page.evaluate(async () => {
    const fixture = window as any;
    fixture.mount("phone", 500);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fixture.pixel();
  });
  expect(early[3]).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).pixel()[0]))
    .toBeGreaterThan(200);
  expect(
    await page.locator("#root canvas").evaluate((canvas) => ({
      width: (canvas as HTMLCanvasElement).width,
      height: (canvas as HTMLCanvasElement).height,
      fit: getComputedStyle(canvas).objectFit,
    })),
  ).toEqual({ width: 90, height: 160, fit: "contain" });
  expect(await page.evaluate(() => (window as any).proof.aspect)).toBe(
    90 / 160,
  );
  const reset = await page.evaluate(async () => {
    const fixture = window as any;
    fixture.proof.color = "blue";
    fixture.mount("phone", 700);
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fixture.pixel();
  });
  expect(reset[3]).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).pixel()[2]))
    .toBeGreaterThan(200);
  const replacement = await page.evaluate(async () => {
    const fixture = window as any;
    fixture.proof.color = "lime";
    fixture.replacePhone();
    await new Promise((resolve) => setTimeout(resolve, 250));
    return fixture.pixel();
  });
  expect(replacement[3]).toBe(0);
  await expect
    .poll(() => page.evaluate(() => (window as any).pixel()[1]))
    .toBeGreaterThan(200);
  await page.evaluate(() => (window as any).mount("phone", 0));
  await expect(page.locator("#root canvas")).toHaveCount(0);
  await expect(page.locator("#root video")).toBeVisible();
});
