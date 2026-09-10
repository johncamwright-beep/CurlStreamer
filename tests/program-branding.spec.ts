import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("program uses the full logo, event-only heading, and clean camera pictures", async ({
  page,
}, testInfo) => {
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
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ProgramCanvas}from'./src/components/ProgramCanvas';import{gameFixture}from'./src/test/game-fixture';function App(){const [event,setEvent]=useState('Single Game');window.setEvent=setEvent;const game=gameFixture();game.config.eventName=event;return <ProgramCanvas game={game} renderCamera={()=> <div style={{position:'absolute',inset:0,background:'#123449'}}/>}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.route("**/program-branding-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<link rel="stylesheet" href="/m4-program-renderer.css"><div id="root"></div><script src="/program-branding-fixture.js"></script>',
    }),
  );
  await page.route("**/program-branding-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.goto("/program-branding-fixture");
  const logo = page.getByRole("img", { name: "Curl Streamer", exact: true });
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await expect(page.getByText("Single Game", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/CAMERA [12]/)).toHaveCount(0);
  await page.evaluate(() =>
    (window as unknown as { setEvent: (v: string) => void }).setEvent(
      "Shorty Jenkins Tournament",
    ),
  );
  await expect(
    page.getByRole("heading", { name: "Shorty Jenkins Tournament" }),
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("program-branding.png") });
});
