import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
let js = "",
  css = "";
test.beforeAll(async () => {
  css =
    execFileSync(
      process.execPath,
      [
        "node_modules/tailwindcss/lib/cli.js",
        "-i",
        "src/app/globals.css",
        "--minify",
      ],
      { encoding: "utf8" },
    ) + readFileSync("src/app/score/[id]/scoring.css", "utf8");
  js = (
    await build({
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      tsconfig: "tsconfig.json",
      stdin: {
        loader: "tsx",
        resolveDir: process.cwd(),
        contents: `
    import React,{useState} from 'react';import{createRoot}from'react-dom/client';
    import{ProgramCanvas}from'./src/components/ProgramCanvas';
    import{CameraZoomControls}from'./src/components/CameraZoomControls';
    const initial={id:'fixture',config:{homeName:'Team Benning',awayName:'Team Test',homeLogoUrl:'/fixture-logo.svg',homeColor:'#e11d48',awayColor:'#2563eb',initialHammer:'home',scheduledEnds:8},scoreEvents:[],layout:'split',sponsors:[],sponsorMode:{active:false,paused:false},cameraZoom:{},programCameraMode:'stacked'};
    function App(){const[game,setGame]=useState(initial);const[reject,setReject]=useState(false);return <main style={{maxWidth:1100,margin:'auto',padding:12}}><ProgramCanvas game={game} cameraAspects={{'camera-home':16/9,'camera-away':16/9}} renderCamera={role=><img className="portrait-camera-video" src="/fixture-camera.svg" alt={role}/>}/><div className="scoring-preview-panel" style={{marginTop:16}}><CameraZoomControls game={game} act={async a=>{if(reject)throw Error('offline');setGame(g=>({...g,programCameraMode:a.mode}));}}/></div><button onClick={()=>setReject(true)}>Reject changes</button></main>};createRoot(document.getElementById('root')).render(<App/>);`,
      },
    })
  ).outputFiles[0].text;
});
test("switches full widescreen to cropped portrait and back with aligned readable branding", async ({
  page,
}, info) => {
  await page.route("**/layout-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>${js}</script></body></html>`,
    }),
  );
  await page.route("**/fixture-camera.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#173d55"/><rect width="60" height="180" fill="#ea580c"/><rect x="260" width="60" height="180" fill="#22c55e"/><circle cx="160" cy="90" r="45" fill="white"/><text x="160" y="97" text-anchor="middle" font-size="22">HOUSE</text></svg>',
    }),
  );
  await page.route("**/fixture-logo.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="48" fill="white"/><text x="50" y="72" text-anchor="middle" font-size="70" font-family="sans-serif" font-weight="bold">B</text></svg>',
    }),
  );
  await page.route("**/branding/curlstreamer-logo.png", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: readFileSync("public/branding/curlstreamer-logo.png"),
    }),
  );
  await page.goto("/layout-fixture");
  const layout = page.getByRole("combobox", { name: "Camera layout" });
  const first = page.getByTestId("camera-panel-camera-home"),
    second = page.getByTestId("camera-panel-camera-away");
  await expect(
    page.getByRole("heading", { name: "Camera Settings" }),
  ).toBeVisible();
  await expect(first.locator("img")).toHaveCSS("object-fit", "contain");
  const a = (await first.boundingBox())!,
    b = (await second.boundingBox())!;
  expect(a.y + a.height).toBeCloseTo(b.y, 0);
  await layout.selectOption("portrait");
  await expect(first.locator("img")).toHaveCSS("object-fit", "cover");
  const p = (await first.boundingBox())!,
    q = (await second.boundingBox())!;
  expect(p.width / p.height).toBeCloseTo(9 / 16, 2);
  expect(p.x + p.width).toBeCloseTo(q.x, 0);
  const score = page.getByTestId("broadcast-scoreboard");
  const logo = page.getByRole("img", { name: "Team Benning logo" });
  const s = (await score.boundingBox())!,
    l = (await logo.boundingBox())!;
  expect(s.y).toBeCloseTo(l.y, 0);
  expect(s.height).toBeCloseTo(l.height, 0);
  const away = (await score
    .getByText("Team Test", { exact: true })
    .boundingBox())!;
  expect(away.y + away.height).toBeLessThanOrEqual(s.y + s.height);
  await expect(score).toHaveCSS("background-color", "rgb(89, 220, 232)");
  await expect(logo).toHaveCSS("object-fit", "contain");
  await page.locator(".broadcast-rail-heading").screenshot({
    path: info.outputPath("scoreboard.png"),
  });
  await page.screenshot({
    path: info.outputPath("portrait-settings.png"),
    fullPage: true,
  });
  await layout.selectOption("stacked");
  await expect(first.locator("img")).toHaveCSS("object-fit", "contain");
  await page.screenshot({
    path: info.outputPath("stacked-settings.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reject changes" }).click();
  await layout.selectOption("portrait");
  await expect(page.getByRole("alert")).toContainText(
    "Could not change camera layout",
  );
  await expect(layout).toHaveValue("stacked");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
