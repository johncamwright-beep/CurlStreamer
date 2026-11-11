import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

const gameId = "11111111-1111-4111-8111-111111111111";
const idlePreview = {
  gameId,
  active: true,
  busy: false,
  canLeaveGame: true,
  title: "Club final",
  presentation: "live",
  streaming: "idle",
  live: false,
  outputActive: false,
  canHoldStream: false,
  canCloseGameDirectly: true,
};

async function loadLeaveFixture(
  page: Page,
  session: typeof idlePreview | null = idlePreview,
  includeYouTube = false,
) {
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
      import {StudioYouTube} from './src/components/StudioYouTube';
      import {StudioSessionContext} from './src/components/StudioSessionContext';
      window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};
      function Fixture() {
        const [session, setSession] = useState(${JSON.stringify(session)});
        window.updateFixtureSession = setSession;
        return <StudioSessionContext.Provider value={session}>${includeYouTube ? `<StudioYouTube id="${gameId}"/>` : ""}<EndGameControl gameId="${gameId}" homeName="Home" awayName="Away" enabled onCompleted={()=>{throw Error('Unexpected completion')}}/></StudioSessionContext.Provider>;
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

test("live sender offers pause and leave, waits for acknowledgement, and retains errors", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page, {
    ...idlePreview,
    streaming: "armed",
    outputActive: true,
    canCloseGameDirectly: false,
  });
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  await expect(
    page.getByRole("dialog", { name: "Broadcast is running" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Pause and leave", exact: true })
    .click();
  await expect(page.getByRole("status")).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("Pausing the broadcast…");
  await expect(page.locator('[role="status"] svg')).toHaveClass(/animate-spin/);
  await expect(
    page.getByRole("button", { name: "End Game", exact: true }),
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
    .getByRole("button", { name: "Pause and leave", exact: true })
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

test("idle preview ignores stale YouTube live; No leaves without ending or pausing", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page, {
    ...idlePreview,
    live: true,
  });
  const close = page.getByRole("button", { name: "Close Game", exact: true });
  await close.click();
  await expect(
    page.getByRole("dialog", { name: "Is this game completed?" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("button", { name: "Close", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Pause and leave" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Yes", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await close.click();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Closing camera preview…");
  await expect(close).toBeDisabled();
  await expect(page.getByRole("dialog")).toBeVisible();
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
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  await page.getByRole("button", { name: "No", exact: true }).click();
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
            error: "Broadcast started.",
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
  await expect(page.getByRole("alert")).toHaveText("Broadcast started.");
  await expect(page).toHaveURL(/leave-fixture$/);
  await expect(
    page.getByRole("button", {
      name: "Pause and leave",
      exact: true,
    }),
  ).toBeEnabled();
  expect(completions()).toBe(0);
});

test("No returns to Games without a Studio session or a completion request", async ({
  page,
}) => {
  const completions = await loadLeaveFixture(page, null);
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  await page.getByRole("button", { name: "No", exact: true }).click();
  await expect(page).toHaveURL(/dashboard$/);
  expect(completions()).toBe(0);
});

test("Stop broadcast followed by Close Game and No leaves the saved game open", async ({
  page,
}) => {
  const broadcastRequests: unknown[] = [];
  await page.route(`**/api/games/${gameId}/studio-m4`, (route) => {
    const stopped = route.request().method() === "POST";
    if (stopped) broadcastRequests.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        desiredState: stopped ? "stopped" : "live",
        status: stopped ? "stopped" : "prepared",
        watchUrl: "https://www.youtube.com/watch?v=abcdefghijk",
      },
    });
  });
  const completions = await loadLeaveFixture(
    page,
    { ...idlePreview, streaming: "armed", outputActive: true, live: true },
    true,
  );
  await expect(page.getByRole("button", { name: "Close Game" })).toBeVisible();
  await page.evaluate((gameId) => {
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId,
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          outputActive: true,
          message: "",
        },
      }),
    );
  }, gameId);
  await page
    .getByRole("button", { name: "Stop broadcast", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Stop broadcast?" })
    .getByRole("button", { name: "Stop broadcast", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Broadcast ended" }),
  ).toBeDisabled();
  await page.evaluate(
    (session) => {
      (window as any).updateFixtureSession(session);
    },
    { ...idlePreview, streaming: "stopped", presentation: "hold" },
  );
  await page.getByRole("button", { name: "Close Game", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Is this game completed?" });
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Pause and leave" }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "No", exact: true }).click();
  await page.evaluate(() => {
    const request = (window as any).sent.find(
      (value: any) => value.type === "studio-game-leave",
    );
    if (request?.previewOnly !== true)
      throw Error("Expected inactive game leave");
    window.dispatchEvent(
      new CustomEvent("studio-game-leave-result", {
        detail: { gameId: request.gameId, nonce: request.nonce, ok: true },
      }),
    );
  });
  await expect(page).toHaveURL(/dashboard$/);
  expect(broadcastRequests).toEqual([{ action: "stop" }]);
  expect(completions()).toBe(0);
});
