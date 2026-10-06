import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("Studio IP zoom stays local, queues intent, preserves drafts, and ignores stale acknowledgments", async ({
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
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {CameraZoomControls} from './src/components/CameraZoomControls';
    window.calls=[];window.cloud=[];window.chrome={webview:{postMessage:m=>window.calls.push(m)}};
    window.sources=(generation=2,zoom=1)=>window.dispatchEvent(new CustomEvent('studio-camera-inputs',{detail:{gameId:'game-1',cameras:{'camera-home':{kind:'rtsp',configured:true,phase:'streaming',generation,zoom},'camera-away':{kind:'phone',configured:false,phase:'idle',generation:0}}}}));
    window.ack=(index,overrides={})=>{const m=window.calls[index];window.dispatchEvent(new CustomEvent('studio-camera-zoom-result',{detail:{gameId:m.gameId,cameraRole:m.cameraRole,generation:m.generation,nonce:m.nonce,ok:true,value:m.value,...overrides}}))};
    createRoot(document.getElementById('root')).render(<CameraZoomControls game={{id:'game-1',cameraZoom:{'camera-away':{supported:true,updatedAt:Date.now(),min:1,max:3,step:.1,value:1}}}} act={async action=>{window.cloud.push(action)}}/>);
  `,
    },
  });
  await page.route("**/ip-zoom-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/ip-zoom-fixture.js"></script>',
    }),
  );
  await page.route("**/ip-zoom-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/ip-zoom-fixture");
  await expect(page.getByTestId("camera-zoom-rail")).toBeVisible();
  await page.evaluate(() => (window as any).sources());
  await expect(page.getByText("1.0× digital zoom")).toBeVisible();
  const plus = page.getByRole("button", {
    name: "Camera 1 zoom in",
    exact: true,
  });
  await plus.click();
  await plus.click();
  await plus.click();
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(1);
  await page.evaluate(() => (window as any).ack(0, { nonce: "wrong" }));
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(1);
  await page.evaluate(() => (window as any).ack(0));
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(2);
  expect(
    await page.evaluate(() => (window as any).calls.map((m: any) => m.value)),
  ).toEqual([1.1, 1.3]);
  await page.evaluate(() => (window as any).ack(1));
  await expect(page.getByText("1.3× digital zoom")).toBeVisible();
  const slider = page.getByRole("slider", { name: "Camera 1 zoom level" });
  await slider.fill("2");
  await page.evaluate(() => (window as any).sources(2, 1.3));
  await expect(slider).toHaveValue("2");
  await slider.dispatchEvent("pointerup");
  await page.evaluate(() => (window as any).ack(2));
  await expect(page.getByText("2.0× digital zoom")).toBeVisible();
  await page.getByRole("button", { name: "Camera 1 reset zoom" }).click();
  await page.evaluate(() => (window as any).ack(3));
  await expect(slider).toHaveValue("1");
  await plus.click();
  await page.evaluate(() => {
    (window as any).sources(3, 1);
    (window as any).ack(4);
  });
  await expect(slider).toHaveValue("1");
  expect(await page.evaluate(() => (window as any).cloud)).toEqual([]);
  await page
    .getByRole("button", { name: "Camera 2 zoom in", exact: true })
    .click();
  expect(await page.evaluate(() => (window as any).cloud[0].type)).toBe(
    "camera-zoom",
  );
  expect(
    await page.evaluate(() => Object.keys((window as any).calls[0]).sort()),
  ).toEqual(["action", "cameraRole", "gameId", "generation", "nonce", "value"]);
});

test("remote hardware zoom queues controls, commits sliders, and reports confirmation failures", async ({
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
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {CameraZoomControls} from './src/components/CameraZoomControls';
        const state={cameraZoom:{'camera-home':{supported:true,updatedAt:Date.now(),min:1,max:3,step:.1,value:1},'camera-away':{supported:false,updatedAt:Date.now()}}};
        window.calls=[];window.zoomResolves=[];window.releaseZoom=()=>window.zoomResolves.shift()?.();
        function Fixture(){const [game,setGame]=useState(state);const [reject,setReject]=useState(false);return <><CameraZoomControls game={game} act={async action=>{window.calls.push(action);await new Promise(r=>window.zoomResolves.push(r));if(reject)throw Error('rejected');if(action.type==='camera-zoom')setGame(g=>({...g,cameraZoom:{...g.cameraZoom,[action.role]:{...g.cameraZoom[action.role],value:action.value,updatedAt:Date.now()}}}))}}/><button onClick={()=>setReject(true)}>Reject next</button></>};
        createRoot(document.getElementById('root')).render(<Fixture/>);
      `,
    },
  });
  await page.route("**/camera-zoom-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/camera-zoom-fixture.js"></script>',
    }),
  );
  await page.route("**/camera-zoom-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/camera-zoom-fixture");
  const out = page.getByRole("button", { name: "Camera 1 zoom out" });
  const plus = page.getByRole("button", { name: "Camera 1 zoom in" });
  await expect(out).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Camera 2 zoom in" }),
  ).toBeDisabled();

  await plus.click();
  await plus.click();
  await plus.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(1);
  await page.evaluate(() => (window as any).releaseZoom());
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(2);
  const queued = await page.evaluate(() =>
    (window as any).calls.map((v: any) => v.value),
  );
  expect(queued).toHaveLength(2);
  expect(queued[0]).toBe(1.1);
  expect(queued[1]).toBe(1.3);
  await page.evaluate(() => (window as any).releaseZoom());
  await expect(
    page.getByText(`${queued[1].toFixed(1)}× hardware zoom`),
  ).toBeVisible();

  const slider = page.getByRole("slider", { name: "Camera 1 zoom level" });
  await slider.fill("2");
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(2);
  await slider.dispatchEvent("pointerup");
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(3);
  await page.evaluate(() => (window as any).releaseZoom());
  await expect(page.getByText("2.0× hardware zoom")).toBeVisible();

  await page.getByRole("button", { name: "Reject next" }).click();
  await plus.click();
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(4);
  await page.evaluate(() => (window as any).releaseZoom());
  await expect(page.getByRole("alert")).toHaveText(
    "Could not send zoom command",
  );
});
