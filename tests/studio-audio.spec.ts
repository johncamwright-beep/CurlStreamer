import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("phone microphone controls stay on the camera cards", async ({ page }) => {
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
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{StudioAudio}from'./src/components/StudioAudio';import{StudioDeviceCards}from'./src/components/StudioDeviceCards';function App(){const[a,set]=useState({});return <><StudioAudio id="game"/><StudioDeviceCards id="game" claims={{'camera-home':'phone'}} enabled cameraAudio={a} onAudio={async(role,enabled,volume)=>set({[role]:{enabled,volume,status:enabled?'pending':'off',updatedAt:Date.now()}})}/></>};createRoot(document.getElementById('root')).render(<App/>);`,
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
  const volume = page.getByRole("slider", { name: "Camera 1 mic volume" });
  await expect(volume).toHaveValue("100");
  await volume.focus();
  await volume.press("Home");
  await expect(volume).toHaveValue("0");
  await volume.press("ArrowRight");
  await expect(volume).toHaveValue("5");
  await page.getByRole("button", { name: "Turn mic on" }).click();
  await expect(
    page.getByRole("button", { name: "Turn mic off" }),
  ).toHaveAttribute("aria-pressed", "true");
  const audio = page.getByRole("region", { name: "Audio", exact: true });
  await expect(
    audio.getByText(/Camera [12]|Mic off|mixed to mono/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Turn mic off" }).click();
  await expect(
    page.getByRole("meter", { name: "Camera 1 audio level" }),
  ).toHaveCount(0);
});
