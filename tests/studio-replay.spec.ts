import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const gameId = "11111111-1111-4111-8111-111111111111";
for (const failedVideo of [false, true])
  test(`replay preparation stays private and returns live (video failure: ${failedVideo})`, async ({
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
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {StudioReplay} from './src/components/StudioReplay';
      Object.defineProperty(navigator,'userAgent',{value:'CurlStreamerStudio/0.3 StudioReplay/1'});
      window.sent=[]; window.chrome={webview:{postMessage(v){window.sent.push(v)}}};
      createRoot(document.getElementById('root')).render(<StudioReplay gameId="${gameId}"/>);
    `,
      },
    });
    await page.route("**/replay-fixture", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<div id="root"></div><script>${bundle.outputFiles[0].text}</script>`,
      }),
    );
    await page.goto("/replay-fixture");
    const media = await readFile("tests/fixtures/studio-replay.webm");
    await page.route("**/__studio-replay/**", (route) =>
      failedVideo
        ? route.abort()
        : route.fulfill({
            contentType: "video/webm",
            body: Buffer.from(media),
          }),
    );
    async function status(state: number, clipId: string | null = null) {
      await page.evaluate(
        ({ gameId, state, clipId }) =>
          window.dispatchEvent(
            new CustomEvent("studio-session-status", {
              detail: {
                gameId,
                active: true,
                replay: {
                  state,
                  durationMs: 62000,
                  availableMs: 60000,
                  clipId,
                },
              },
            }),
          ),
        { gameId, state, clipId },
      );
    }
    async function receipt() {
      await page.evaluate(() => {
        const request = (window as any).sent
          .filter((x: any) => x.type === "studio-replay")
          .at(-1);
        window.dispatchEvent(
          new CustomEvent("studio-replay-result", {
            detail: { ...request, ok: true },
          }),
        );
      });
    }
    await expect(
      page.getByRole("button", { name: "Replay", exact: true }),
    ).toBeDisabled();
    await status(1);
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(
      await page.evaluate(() =>
        (window as any).sent
          .filter((x: any) => x.type === "studio-replay")
          .map((x: any) => x.action),
      ),
    ).toEqual(["capture"]);
    await receipt();
    await status(3, "22222222-2222-4222-8222-222222222222");
    if (!failedVideo)
      await expect(
        page.getByRole("button", { name: "Play Replay" }),
      ).toBeEnabled();
    await page.getByRole("button", { name: "15s", exact: true }).click();
    await expect(
      page.getByRole("slider", { name: "Replay start" }),
    ).toHaveValue("47000");
    await page.getByRole("button", { name: "60s", exact: true }).click();
    await expect(
      page.getByRole("slider", { name: "Replay start" }),
    ).toHaveValue("2000");
    if (failedVideo) {
      await expect(
        page.getByRole("button", { name: "Play Replay" }),
      ).toBeDisabled();
      expect(
        await page.evaluate(
          () =>
            (window as any).sent.filter((x: any) => x.action === "play").length,
        ),
      ).toBe(0);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await receipt();
      await status(5, "22222222-2222-4222-8222-222222222222");
    } else {
      await expect(
        page.getByRole("button", { name: "Play Replay" }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Play Replay" }).click();
      expect(
        await page.evaluate(() =>
          (window as any).sent.filter((x: any) => x.action === "play").at(-1),
        ),
      ).toMatchObject({
        startMs: 2000,
        clipId: "22222222-2222-4222-8222-222222222222",
      });
      await receipt();
      await status(5, "22222222-2222-4222-8222-222222222222");
      await page.getByRole("button", { name: "Close", exact: true }).click();
    }
    await page
      .getByRole("button", { name: "Return Live", exact: true })
      .click();
    expect(
      await page.evaluate(
        () =>
          (window as any).sent
            .filter((x: any) => x.type === "studio-replay")
            .at(-1).action,
      ),
    ).toBe("cancel");
    await receipt();
    await status(0);
    await expect(
      page.getByRole("button", { name: /Replay · buffering/ }),
    ).toBeDisabled();
  });
