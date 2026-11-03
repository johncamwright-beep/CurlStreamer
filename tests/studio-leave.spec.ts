import { test, expect } from "@playwright/test";
import { build } from "esbuild";

const gameId = "11111111-1111-4111-8111-111111111111";
test("leave pauses without finalizing, waits for acknowledgement, and retains errors", async ({
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
      import React from 'react';import {createRoot} from 'react-dom/client';
      import {EndGameControl} from './src/components/EndGameControl';
      import {StudioSessionContext} from './src/components/StudioSessionContext';
      window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};
      createRoot(document.getElementById('root')).render(<StudioSessionContext.Provider value={{gameId:'${gameId}',active:true,busy:false,canLeaveGame:true}}><EndGameControl gameId="${gameId}" homeName="Home" awayName="Away" enabled onCompleted={()=>{throw Error('Unexpected completion')}}/></StudioSessionContext.Provider>);
    `,
    },
  });
  let completions = 0;
  await page.route("**/api/games/*/completion", (route) => {
    completions++;
    return route.fulfill({ status: 500 });
  });
  await page.route("**/leave-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  await page.route("**/dashboard", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Games</h1>" }),
  );
  await page.goto("/leave-fixture");
  await page.getByRole("button", { name: "Game options", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave game and pause stream", exact: true })
    .click();
  await expect(
    page.getByText("Pausing stream and saving recording…"),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.evaluate(() => {
    const request = (window as any).sent.find(
      (v: any) => v.type === "studio-game-leave",
    );
    window.dispatchEvent(
      new CustomEvent("studio-game-leave-result", {
        detail: { ...request, type: undefined, ok: true },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("studio-game-leave-result", {
        detail: {
          gameId: request.gameId,
          nonce: request.nonce,
          ok: false,
          error: "Recording still closing",
        },
      }),
    );
  });
  await expect(page.getByRole("alert")).toHaveText("Recording still closing");
  await expect(page).toHaveURL(/leave-fixture$/);
  await page
    .getByRole("button", { name: "Leave game and pause stream", exact: true })
    .click();
  await page.evaluate(() => {
    const request = (window as any).sent
      .filter((v: any) => v.type === "studio-game-leave")
      .at(-1);
    window.dispatchEvent(
      new CustomEvent("studio-game-leave-result", {
        detail: { gameId: request.gameId, nonce: request.nonce, ok: true },
      }),
    );
  });
  await expect(page).toHaveURL(/dashboard$/);
  expect(completions).toBe(0);
});
