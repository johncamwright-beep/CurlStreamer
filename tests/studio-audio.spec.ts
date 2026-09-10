import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("phone microphone controls and meters distinguish intent from received audio", async ({
  page,
}) => {
  const bundle = await build({
    bundle: true,
    write: false,
    outfile: "audio-fixture.js",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      loader: "tsx",
      resolveDir: process.cwd(),
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{StudioAudio}from'./src/components/StudioAudio';import{StudioDeviceCards}from'./src/components/StudioDeviceCards';function App(){const[a,set]=useState({});return <><StudioAudio id="game" cameraAudio={a}/><StudioDeviceCards id="game" claims={{'camera-home':'phone'}} enabled cameraAudio={a} onAudio={async(role,enabled)=>set({[role]:{enabled,status:enabled?'pending':'off',updatedAt:Date.now()}})}/></>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.route("**/audio-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/audio-fixture.js"></script>',
    }),
  );
  await page.route("**/audio-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route("**/api/games/game/studio-devices", (route) =>
    route.fulfill({
      json: {
        cameras: { "camera-home": { receiverReady: true, phoneOnline: true } },
      },
    }),
  );
  await page.goto("/audio-fixture");
  await expect(
    page.getByRole("meter", { name: "Camera 1 audio level" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Turn mic on" }).click();
  await expect(
    page.getByText("Waiting for audio", { exact: true }),
  ).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-audio-status", {
        detail: {
          gameId: "other-game",
          cameras: { "camera-home": { peak: 0.8, rms: 0.2, receiving: true } },
        },
      }),
    ),
  );
  await expect(
    page.getByRole("meter", { name: "Camera 1 audio level" }),
  ).toHaveAttribute("value", "0");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-audio-status", {
        detail: {
          gameId: "game",
          cameras: { "camera-home": { peak: 0.8, rms: 0.2, receiving: true } },
        },
      }),
    ),
  );
  await expect(
    page.getByText("Receiving audio", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("meter", { name: "Camera 1 audio level" }),
  ).toHaveAttribute("value", "0.8");
  await page.getByRole("button", { name: "Turn mic off" }).click();
  await expect(
    page.getByRole("meter", { name: "Camera 1 audio level" }),
  ).toHaveCount(0);
});
