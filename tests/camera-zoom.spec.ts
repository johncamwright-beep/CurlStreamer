import { expect, test } from "@playwright/test";
import { build } from "esbuild";

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
        window.calls=[];
        function Fixture(){const [game,setGame]=useState(state);const [reject,setReject]=useState(false);window.rejectZoom=()=>setReject(true);return <><CameraZoomControls game={game} act={async action=>{window.calls.push(action);await new Promise(r=>setTimeout(r,40));if(reject)throw Error('rejected');if(action.type==='camera-zoom')setGame(g=>({...g,cameraZoom:{...g.cameraZoom,[action.role]:{...g.cameraZoom[action.role],value:action.value,updatedAt:Date.now()}}}))}}/><button onClick={()=>setReject(true)}>Reject next</button></>};
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
    .toBe(2);
  const queued = await page.evaluate(() =>
    (window as any).calls.map((v: any) => v.value),
  );
  expect(queued).toHaveLength(2);
  expect(queued[0]).toBe(1.1);
  expect(queued[1]).toBeGreaterThan(queued[0]);
  await expect(
    page.getByText(`${queued[1].toFixed(1)}× hardware zoom`),
  ).toBeVisible();

  const slider = page.getByRole("slider", { name: "Camera 1 zoom level" });
  await slider.fill("2");
  await page.waitForTimeout(80);
  expect(await page.evaluate(() => (window as any).calls.length)).toBe(2);
  await slider.dispatchEvent("pointerup");
  await expect
    .poll(() => page.evaluate(() => (window as any).calls.length))
    .toBe(3);
  await expect(page.getByText("2.0× hardware zoom")).toBeVisible();

  await page.getByRole("button", { name: "Reject next" }).click();
  await plus.click();
  await expect(page.getByRole("alert")).toHaveText(
    "Could not send zoom command",
  );
});
