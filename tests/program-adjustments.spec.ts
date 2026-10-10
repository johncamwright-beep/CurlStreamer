import { test, expect } from "@playwright/test";
import { build } from "esbuild";

test("portrait pan, external mic delay and slower sponsors save independent settings", async ({
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
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{CameraZoomControls}from'./src/components/CameraZoomControls';
    import{ScoringProgramControls}from'./src/components/ScoringProgramControls';
    import{gameFixture}from'./src/test/game-fixture';
    window.calls=[];window.sources=()=>window.dispatchEvent(new CustomEvent('studio-camera-inputs',{detail:{gameId:'fixture',cameras:{'camera-home':{kind:'tapo',configured:true,connectionEnabled:true,phase:'streaming',generation:2,zoom:2},'camera-away':{kind:'rtsp',configured:true,connectionEnabled:true,phase:'streaming',generation:4,zoom:2}}}}));
    function App(){const[game,setGame]=useState({...gameFixture(),id:'fixture',programCameraMode:'portrait'});const act=async a=>{window.calls.push(a);setGame(g=>a.type==='camera-pan'?{...g,cameraPan:{...g.cameraPan,[a.role]:a.value}}:a.type==='program-audio-delay'?{...g,programAudioDelayMs:a.milliseconds}:a.type==='camera-composition'?{...g,programCameraMode:a.mode}:a.type==='sponsor-mode'?{...g,sponsorMode:{...g.sponsorMode,...a}}:g)};return <><CameraZoomControls game={game} act={act}/><ScoringProgramControls game={game} act={act} compact/></>};createRoot(document.getElementById('root')).render(<App/>);
  `,
    },
  });
  await page.route("**/adjustments-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.goto("/adjustments-fixture");
  await expect(
    page.getByRole("combobox", { name: "Camera layout" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).sources());
  const delay = page.getByRole("combobox", {
    name: "External microphone delay",
  });
  await expect(delay).toHaveValue("1000");
  await delay.selectOption("2500");
  await expect(delay).toHaveValue("2500");
  const left = page.getByRole("button", {
    name: "Camera 1 pan left",
    exact: true,
  });
  for (let i = 0; i < 10; i++) await left.click();
  await expect(left).toBeDisabled();
  await page
    .getByRole("button", { name: "Camera 2 pan right", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Camera 1 center picture", exact: true })
    .click();
  const actions = await page.evaluate(() => (window as any).calls);
  expect(actions).toContainEqual({
    type: "program-audio-delay",
    milliseconds: 2500,
  });
  expect(actions).toContainEqual({
    type: "camera-pan",
    role: "camera-home",
    value: -1,
  });
  expect(actions).toContainEqual({
    type: "camera-pan",
    role: "camera-away",
    value: 0.1,
  });
  expect(actions).toContainEqual({
    type: "camera-pan",
    role: "camera-home",
    value: 0,
  });
  await page
    .getByRole("combobox", { name: "Camera layout" })
    .selectOption("stacked");
  await expect(left).toHaveCount(0);
  await page.getByLabel("Carousel settings", { exact: true }).click();
  await page.getByLabel("Seconds per sponsor").selectOption("30");
  await expect(page.getByLabel("Seconds per sponsor")).toHaveValue("30");
});
