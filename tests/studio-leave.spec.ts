import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

const gameId = "11111111-1111-4111-8111-111111111111";
const legacy = { gameId, active: true, busy: false, canLeaveGame: true };
const idlePreview = {
  ...legacy,
  title: "Club final",
  presentation: "live",
  streaming: "idle",
  live: false,
  outputActive: false,
  canHoldStream: false,
  canCloseGameDirectly: true,
};

async function loadLeaveFixture(page: Page, session = legacy) {
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
      import React, {useState} from 'react';import {createRoot} from 'react-dom/client';
      import {EndGameControl} from './src/components/EndGameControl';
      import {StudioSessionContext} from './src/components/StudioSessionContext';
      window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};
      function Fixture() {
        const [session, setSession] = useState(${JSON.stringify(session)});
        window.updateFixtureSession = setSession;
        return <StudioSessionContext.Provider value={session}><EndGameControl gameId="${gameId}" homeName="Home" awayName="Away" enabled onCompleted={()=>{throw Error('Unexpected completion')}}/></StudioSessionContext.Provider>;
      }
      createRoot(document.getElementById('root')).render(<Fixture/>);
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
  return () => completions;
}

test("legacy leave pauses without finalizing, waits for acknowledgement, and retains errors", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page);
  await page.getByRole("button", { name: "Game options", exact: true }).click();
  await page
    .getByRole("button", { name: "Leave game and pause stream", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText(
    "Pausing the broadcast and closing cameras…",
  );
  await expect(page.locator('[role="status"] svg')).toHaveClass(/animate-spin/);
  await expect(
    page.getByRole("button", { name: "End game and stream", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Use the updated Windows Studio/)).toHaveCount(0);
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
  expect(completions()).toBe(0);
});

test("X closes an idle Studio preview while End game stays available", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page, idlePreview);
  await page.getByRole("button", { name: "End game", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Review final score" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();

  const close = page.getByRole("button", { name: "Close game", exact: true });
  await close.click();
  await expect(page.getByRole("status")).toHaveText("Closing camera preview…");
  await expect(close).toBeDisabled();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/leave-fixture$/);

  const sent = await page.evaluate(() =>
    (window as any).sent.filter((v: any) => v.type === "studio-game-leave"),
  );
  expect(sent).toEqual([
    {
      type: "studio-game-leave",
      gameId,
      nonce: expect.any(String),
      previewOnly: true,
    },
  ]);
  await page.evaluate(
    (detail) => {
      window.dispatchEvent(
        new CustomEvent("studio-game-leave-result", { detail }),
      );
    },
    { gameId, nonce: sent[0].nonce, ok: true },
  );
  await expect(page).toHaveURL(/dashboard$/);
  expect(completions()).toBe(0);
});

test("a refused preview close stays in the game and offers the live options", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page, idlePreview);
  await page.getByRole("button", { name: "Close game", exact: true }).click();
  await page.evaluate(
    (liveSession) => {
      const request = (window as any).sent.find(
        (v: any) => v.type === "studio-game-leave",
      );
      (window as any).updateFixtureSession(liveSession);
      window.dispatchEvent(
        new CustomEvent("studio-game-leave-result", {
          detail: {
            gameId: request.gameId,
            nonce: request.nonce,
            ok: false,
            error: "Broadcast started. Use Game options to leave.",
          },
        }),
      );
    },
    {
      ...idlePreview,
      streaming: "armed",
      live: true,
      outputActive: true,
      canCloseGameDirectly: false,
    },
  );
  await expect(page.getByRole("alert")).toHaveText(
    "Broadcast started. Use Game options to leave.",
  );
  await expect(page).toHaveURL(/leave-fixture$/);
  await page.getByRole("button", { name: "Game options", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Leave game and pause stream",
      exact: true,
    }),
  ).toBeEnabled();
  expect(completions()).toBe(0);
});
