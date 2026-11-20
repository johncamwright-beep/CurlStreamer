import { test, expect } from "@playwright/test";
import { build } from "esbuild";
const key = "curlstreamer-microphone-sync-ms-v1";
test("last confirmed mic sync survives reload and restores the current calibration in new and older games", async ({
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
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {MicrophoneSyncControl} from './src/components/MicrophoneSyncControl';
import {useRememberedMicrophoneSync} from './src/components/useRememberedMicrophoneSync';
window.calls=[];window.fail=false;
function App(){const params=new URLSearchParams(location.search);const[game,setGame]=useState({id:params.get('game')||'current',programAudioDelayMs:params.has('value')?Number(params.get('value')):undefined});const act=React.useCallback(async action=>{window.calls.push(action);if(window.fail)throw Error('offline');setGame(g=>({...g,programAudioDelayMs:action.milliseconds}));},[]);const error=useRememberedMicrophoneSync(game,true,act);return <><MicrophoneSyncControl value={game.programAudioDelayMs} act={act}/><p>{error}</p><button onClick={()=>setGame(g=>({...g}))}>Poll</button></>};createRoot(document.getElementById('root')).render(<App/>);`,
    },
  });
  await page.route("**/mic-memory-fixture*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id='root'></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.goto("/mic-memory-fixture?game=current&value=2200");
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), key))
    .toBe("2200");
  await page.goto("/mic-memory-fixture?game=new");
  const input = page.getByRole("spinbutton", {
    name: "Microphone sync adjustment",
  });
  await expect(input).toHaveValue("2.2");
  await page.getByRole("button", { name: "Poll", exact: true }).click();
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    { type: "program-audio-delay", milliseconds: 2200 },
  ]);
  await input.fill("0");
  await input.press("Enter");
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), key))
    .toBe("0");
  await page.reload();
  await expect(input).toHaveValue("0");
  await page.evaluate(() => {
    (window as any).fail = true;
  });
  await input.fill("1.25");
  await input.press("Enter");
  await expect(page.getByRole("alert")).toContainText("Could not save");
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe("0");
  await page.goto("/mic-memory-fixture?game=old&value=-1250");
  // The saved PC calibration remains authoritative when reopening an older game.
  await expect(input).toHaveValue("0");
  expect(await page.evaluate(() => (window as any).calls)).toEqual([
    { type: "program-audio-delay", milliseconds: 0 },
  ]);
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).toBe("0");
  await input.fill("2.2");
  await input.press("Enter");
  await expect
    .poll(() => page.evaluate((k) => localStorage.getItem(k), key))
    .toBe("2200");
  await page.goto("/mic-memory-fixture?game=next");
  await expect(input).toHaveValue("2.2");
});
