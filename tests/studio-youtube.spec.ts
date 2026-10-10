import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

async function startupFixture(page: Page) {
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioYouTube} from './src/components/StudioYouTube';window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};const root=createRoot(document.getElementById('root'));window.renderGame=id=>root.render(<StudioYouTube id={id}/>);window.renderGame('fixture-game');`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/startup-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/startup-fixture.js"></script>',
    }),
  );
  await page.route("**/startup-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  return async (overrides: Record<string, unknown> = {}) =>
    page.evaluate(
      (detail) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", { detail }),
        ),
      {
        gameId: "fixture-game",
        available: true,
        busy: false,
        streaming: "armed",
        live: false,
        receiving: false,
        outputActive: true,
        canHoldStream: true,
        message: "",
        ...overrides,
      },
    );
}

test("Studio starts now despite delayed reception telemetry and retries without restarting the encoder", async ({
  page,
}) => {
  const report = await startupFixture(page);
  const requests: unknown[] = [];
  const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
  await page.route("**/api/games/fixture-game/studio-m4", (r) => {
    if (r.request().method() !== "POST")
      return r.fulfill({ json: { watchUrl } });
    requests.push(r.request().postDataJSON());
    const status =
      requests.length === 1
        ? 409
        : requests.length === 2
          ? 503
          : requests.length === 3
            ? 403
            : 200;
    return r.fulfill({
      status,
      json:
        status === 200
          ? { phase: "starting", watchUrl }
          : { error: "Unavailable" },
    });
  });
  await page.clock.install();
  await page.goto("/startup-fixture");
  await report({ outputActive: false });
  expect(requests).toHaveLength(0);
  await expect(page.getByRole("button", { name: "Go live now" })).toHaveCount(
    0,
  );
  // An active encoder is sufficient to check; the server independently
  // verifies YouTube reception before it requests a live transition.
  await report();
  await expect(page.getByRole("alert")).toContainText("Retrying automatically");
  await page.clock.fastForward(11000);
  await report();
  await expect.poll(() => requests.length).toBe(2);
  await expect(page.getByRole("button", { name: "Go live now" })).toBeEnabled();
  await page.getByRole("button", { name: "Go live now" }).click();
  await expect(page.getByRole("alert")).toContainText("needs attention");
  await page.clock.fastForward(60000);
  await report();
  expect(requests).toHaveLength(3);
  await page.getByRole("button", { name: "Go live now" }).click();
  await expect.poll(() => requests.length).toBe(4);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByText("Starting this broadcast now.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("status")).not.toHaveText("● LIVE");
  await report({ live: true, receiving: true });
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await expect(page.getByRole("button", { name: "Go live now" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  expect(requests).toEqual(Array(4).fill({ action: "go-live" }));
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([]);
});

test("Late go-live failures cannot overwrite confirmed live status or a different game", async ({
  page,
}) => {
  const report = await startupFixture(page);
  let release!: () => void;
  let requests = 0;
  await page.route("**/api/games/*/studio-m4", async (r) => {
    if (r.request().method() !== "POST") return r.fulfill({ json: {} });
    requests++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await r
      .fulfill({ status: 403, json: { error: "Unavailable" } })
      .catch(() => {});
  });
  await page.clock.install();
  await page.goto("/startup-fixture");
  await report();
  await expect.poll(() => requests).toBe(1);
  await report({ live: true });
  release();
  await expect(page.getByRole("button", { name: "Going live…" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await report({ streaming: "idle", outputActive: false });
  await page.clock.fastForward(11000);
  await report();
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(() =>
    (window as unknown as { renderGame(id: string): void }).renderGame(
      "next-game",
    ),
  );
  await expect(page.getByRole("status")).toHaveText("Status unavailable");
  release();
  await report({ gameId: "next-game" });
  await expect.poll(() => requests).toBe(3);
  await expect(page.getByRole("alert")).toHaveCount(0);
  release();
  await expect(page.getByRole("alert")).toContainText("needs attention");
});

for (const phase of ["ended", "removed"]) {
  test(`Studio cannot retry a ${phase} broadcast`, async ({ page }) => {
    const report = await startupFixture(page);
    let requests = 0;
    await page.route("**/api/games/fixture-game/studio-m4", (r) => {
      if (r.request().method() === "POST") requests++;
      return r.fulfill({ json: { phase } });
    });
    await page.clock.install();
    await page.goto("/startup-fixture");
    await report();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("button", { name: "Go live now" })).toHaveCount(
      0,
    );
    await page.clock.fastForward(60000);
    await report();
    expect(requests).toBe(1);
  });
}

test("Studio YouTube sends game-scoped commands and expires live status", async ({
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
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioYouTube} from './src/components/StudioYouTube';window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};createRoot(document.getElementById('root')).render(<StudioYouTube id="fixture-game"/>);`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/youtube-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/youtube-fixture.js"></script>',
    }),
  );
  await page.route("**/youtube-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.clock.install();
  const requests: unknown[] = [];
  const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
  await page.route("**/api/games/fixture-game/studio-m4", (r) => {
    if (r.request().method() === "POST")
      requests.push(r.request().postDataJSON());
    return r.fulfill({
      json: { desiredState: "live", status: "prepared", watchUrl },
    });
  });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: async (value: string) => {
          (window as unknown as { copied: string }).copied = value;
        },
      },
    });
  });
  await page.goto("/youtube-fixture");
  const start = page.getByRole("button", { name: "Broadcast to YouTube" });
  await expect(start).toBeDisabled();
  const report = async (
    gameId: string,
    live = false,
    receiving = live,
    streaming = receiving ? "armed" : "idle",
  ) =>
    page.evaluate(
      ({ gameId, live, receiving, streaming }) =>
        window.dispatchEvent(
          new CustomEvent("studio-youtube-status", {
            detail: {
              gameId,
              available: true,
              busy: false,
              streaming,
              live,
              receiving,
              message: "",
              canReconnect: true,
              outputActive: false,
            },
          }),
        ),
      { gameId, live, receiving, streaming },
    );
  await report("wrong-game", true);
  await expect(start).toBeDisabled();
  await report("fixture-game");
  await start.click();
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([{ type: "studio-youtube-start", gameId: "fixture-game" }]);
  expect(requests).toHaveLength(0);
  await report("fixture-game", false, true);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests).toEqual([{ action: "go-live" }]);
  await expect(
    page.getByRole("button", { name: "Go live now", exact: true }),
  ).toBeEnabled();
  // YouTube may acknowledge the request before it finishes going live.
  await page.clock.fastForward(11000);
  await report("fixture-game", false, true);
  await expect.poll(() => requests.length).toBe(2);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", true);
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          outputActive: true,
          concurrentViewers: 27,
          message: "",
          canReconnect: true,
        },
      }),
    ),
  );
  await expect(
    page.getByText("27 watching now", { exact: false }),
  ).toBeVisible();
  await report("fixture-game", true);
  await expect(page.getByText("27 last reported")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          outputActive: true,
          concurrentViewers: 32,
          message: "",
          canReconnect: true,
        },
      }),
    ),
  );
  await expect(page.getByText("32 watching now")).toBeVisible();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "armed",
          live: false,
          receiving: false,
          outputActive: true,
          lastLiveAgeMs: 12000,
          message: "",
          canReconnect: true,
        },
      }),
    ),
  );
  await expect(page.getByRole("status")).toHaveText(
    "LIVE last confirmed · Rechecking…",
  );
  await expect(page.getByText("32 last reported")).toBeVisible();
  await report("fixture-game", true);
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("target", "_blank");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page.getByRole("button", { name: "Copy link" }).click();
  expect(
    await page.evaluate(() => (window as unknown as { copied: string }).copied),
  ).toBe(watchUrl);
  await report("fixture-game", false, false, "armed");
  await expect(page.getByRole("status")).toHaveText("Checking status…");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeEnabled();
  await page.clock.fastForward(11000);
  await report("fixture-game", false, true, "armed");
  await expect(page.getByRole("status")).toHaveText("Receiving video");
  // Losing a status sample does not request another live transition for an
  // already confirmed broadcast or hide its verified watch destination.
  expect(requests).toHaveLength(2);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", true);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  expect(
    await page.evaluate(() => (window as unknown as { sent: unknown[] }).sent),
  ).toEqual([
    { type: "studio-youtube-start", gameId: "fixture-game" },
    { type: "studio-youtube-stop", gameId: "fixture-game" },
  ]);
  await report("fixture-game", false, false, "paused");
  await expect(page.getByRole("status")).toHaveText("Disconnected");
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page.getByRole("button", { name: "Reconnect", exact: true }).click();
  await report("fixture-game", true);
  await page.clock.fastForward(7000);
  await expect(page.getByRole("status")).toHaveText("Status unavailable");
  await expect(start).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await report("fixture-game", false, false, "stopped");
  await expect(page.getByRole("status")).toHaveText("Not live");
  await expect(
    page.getByRole("button", { name: "Restart Studio to reconnect" }),
  ).toBeDisabled();
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "failed",
          live: false,
          receiving: false,
          message: "",
          canRecover: true,
          needsRecovery: true,
        },
      }),
    ),
  );
  const recover = page.getByRole("button", {
    name: "Reconnect broadcast",
    exact: true,
  });
  await expect(recover).toBeEnabled();
  await expect(
    page.getByText(/Reconnect restarts the local cameras/),
  ).toBeVisible();
  await recover.click();
  await expect(
    page.getByRole("button", { name: "Please wait…" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      (window as unknown as { sent: unknown[] }).sent.at(-1),
    ),
  ).toEqual({ type: "studio-youtube-start", gameId: "fixture-game" });
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  // Older launchers still interpret Stop as final completion. Never send a
  // pause command until the native bridge advertises the new capability.
  await page.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("studio-youtube-status", {
        detail: {
          gameId: "fixture-game",
          available: true,
          busy: false,
          streaming: "armed",
          live: true,
          receiving: true,
          message: "",
        },
      }),
    ),
  );
  await expect(
    page.getByRole("button", { name: "Disconnect", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/Update Windows Studio/)).toBeVisible();
});

test("Studio pause waits for a correlated native receipt and reports failures while live", async ({
  page,
}) => {
  const gameId = "11111111-1111-4111-8111-111111111111";
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    stdin: {
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {StudioYouTube} from './src/components/StudioYouTube';window.sent=[];window.chrome={webview:{postMessage(v){window.sent.push(v)}}};const root=createRoot(document.getElementById('root'));window.renderGame=id=>root.render(<StudioYouTube id={id}/>);window.renderGame('${gameId}');`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
  });
  await page.route("**/youtube-hold-fixture", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/youtube-hold-fixture.js"></script>',
    }),
  );
  await page.route("**/youtube-hold-fixture.js", (r) =>
    r.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  const watchUrl = "https://www.youtube.com/watch?v=abcdefghijk";
  const mutations: unknown[] = [];
  await page.route(`**/api/games/${gameId}/studio-m4`, (r) => {
    if (r.request().method() === "POST")
      mutations.push(r.request().postDataJSON());
    return r.fulfill({ json: { watchUrl } });
  });
  await page.clock.install();
  await page.goto("/youtube-hold-fixture");
  const report = async (mode: "live" | "hold", generation: number) =>
    page.evaluate(
      ({ mode, generation, gameId }) =>
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
              canReconnect: true,
              canHoldStream: true,
              presentation: { mode, generation },
            },
          }),
        ),
      { mode, generation, gameId },
    );
  const sent = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            sent: { type: string; gameId: string; nonce: string }[];
          }
        ).sent,
    );
  const receipt = (detail: unknown) =>
    page.evaluate(
      (detail) =>
        window.dispatchEvent(
          new CustomEvent("studio-presentation-result", { detail }),
        ),
      detail,
    );
  const waiting = page.getByRole("button", {
    name: "Please wait…",
    exact: true,
  });
  const pause = page.getByRole("button", {
    name: "Pause broadcast",
    exact: true,
  });
  const resume = page.getByRole("button", {
    name: "Resume broadcast",
    exact: true,
  });
  await report("live", 0);
  await page
    .getByRole("button", { name: "Pause broadcast", exact: true })
    .click();
  const hold = (await sent())[0];
  expect(hold).toMatchObject({ type: "studio-youtube-hold", gameId });
  expect(hold.nonce).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  await report("live", 0);
  await expect(waiting).toBeDisabled();
  await receipt({
    ...hold,
    gameId: "22222222-2222-4222-8222-222222222222",
    ok: true,
    presentation: { mode: "hold", generation: 1 },
  });
  await receipt({
    ...hold,
    nonce: "33333333-3333-4333-8333-333333333333",
    ok: true,
    presentation: { mode: "hold", generation: 1 },
  });
  await expect(waiting).toBeDisabled();
  await receipt({
    ...hold,
    ok: true,
    error: null,
    presentation: { mode: "hold", generation: 1 },
  });
  await expect(resume).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText("● LIVE · Paused");
  // A delayed pre-command poll cannot overwrite the acknowledged picture.
  await report("live", 0);
  await expect(resume).toBeEnabled();
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  await page
    .getByRole("button", { name: "Resume broadcast", exact: true })
    .click();
  const release = (await sent())[1];
  expect(release).toMatchObject({ type: "studio-youtube-resume", gameId });
  expect(release.nonce).not.toBe(hold.nonce);
  await report("hold", 1);
  await expect(waiting).toBeDisabled();
  await receipt({
    ...release,
    ok: true,
    error: null,
    presentation: { mode: "live", generation: 2 },
  });
  await expect(pause).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await pause.click();
  await receipt({
    ...(await sent())[2],
    ok: false,
    error: "Studio could not confirm this presentation change.",
    presentation: null,
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Studio could not confirm this presentation change.",
  );
  await expect(pause).toBeEnabled();
  await expect(page.getByRole("status")).toHaveText("● LIVE");
  await pause.click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.clock.fastForward(5000);
  await report("live", 2);
  await expect(waiting).toBeDisabled();
  await page.clock.fastForward(5000);
  await report("live", 2);
  await page.clock.fastForward(2000);
  await expect(page.getByRole("alert")).toHaveText(
    "Studio did not confirm the broadcast card in time.",
  );
  await expect(pause).toBeEnabled();
  expect(mutations).toHaveLength(0);
  await expect(
    page.getByRole("link", { name: "Watch on YouTube" }),
  ).toHaveAttribute("href", watchUrl);
  // A restarted program has a new generation sequence; the receipt fence is
  // bounded, so it cannot permanently retain the previous program's picture.
  await report("live", 0);
  await pause.click();
  const previousGameRequest = (await sent())[4];
  const nextGame = "44444444-4444-4444-8444-444444444444";
  await page.route(`**/api/games/${nextGame}/studio-m4`, (r) =>
    r.fulfill({ json: {} }),
  );
  await page.evaluate(
    (id) =>
      (window as unknown as { renderGame(id: string): void }).renderGame(id),
    nextGame,
  );
  // React replaces the game's status listener in its effect. Wait for that
  // reset before delivering the first native status for the new game.
  await expect(
    page.getByRole("button", { name: "Broadcast to YouTube", exact: true }),
  ).toBeDisabled();
  await page.evaluate(
    (gameId) =>
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
            canHoldStream: true,
            presentation: { mode: "live", generation: 0 },
          },
        }),
      ),
    nextGame,
  );
  await pause.click();
  const nextGameRequest = (await sent())[5];
  expect(nextGameRequest.gameId).toBe(nextGame);
  await receipt({ ...previousGameRequest, ok: false, error: "Old game error" });
  await expect(waiting).toBeDisabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await receipt({
    ...nextGameRequest,
    ok: true,
    presentation: { mode: "hold", generation: 1 },
  });
  await expect(resume).toBeEnabled();
});
