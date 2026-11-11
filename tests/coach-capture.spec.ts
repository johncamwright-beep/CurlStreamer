import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { startCoachLocalProof } from "../src/lib/providers/coach-local-proof";
const gameId = "11111111-1111-4111-8111-111111111111";
const appOrigin = "https://coach.example.test";
test("Shot Tracker captures over LAN, scrubs locally and saves only flag metadata", async ({
  page,
  context,
}) => {
  const proof = await startCoachLocalProof({
    host: "127.0.0.1",
    port: 0,
    code: "123456",
    duration: 120,
    bridge: { appOrigin, gameId },
    capture: async () => ({
      video: resolve("public/celebrations/cat-dance.mp4"),
      duration: 5,
      capturedAt: "2026-11-10T15:00:00.000Z",
    }),
  });
  try {
    const bundle = await build({
      stdin: {
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import LocalFlagCapture from './src/app/curlcoach/LocalFlagCapture';createRoot(document.getElementById('root')).render(<LocalFlagCapture gameId="${gameId}" playerId="alex" playerName="Alex" scopeKey="test-account" onSaved={()=>document.body.dataset.saved='yes'}/>);`,
        resolveDir: process.cwd(),
        loader: "tsx",
      },
      bundle: true,
      write: false,
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"production"' },
    });
    const css = await readFile("src/app/curlcoach/coach.css", "utf8");
    let body: any;
    await context.route(`${appOrigin}/**`, async (route) => {
      if (route.request().url().endsWith("/api/curlcoach/local-review")) {
        body = route.request().postDataJSON();
        await route.fulfill({ json: { saved: true } });
        return;
      }
      await route.fulfill({
        contentType: "text/html",
        body: `<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#071521;color:#eaf3ff;font-family:Arial,sans-serif}${css}</style><div class="coach-workspace"><div class="coach-lab" id="root"></div></div><script>${bundle.outputFiles[0].text}</script></html>`,
      });
    });
    await page.goto(appOrigin);
    await page
      .getByRole("button", { name: "Flag recent video", exact: true })
      .click();
    await page.getByLabel("Laptop address").fill(proof.address);
    await page.getByLabel("Pairing code").fill("123456");
    await page
      .getByRole("button", { name: "Capture recent video", exact: true })
      .click();
    await expect(page.locator("video")).toHaveAttribute("src", /^blob:/, {
      timeout: 15000,
    });
    const save = page.getByRole("button", { name: "Save flag", exact: true });
    await expect(save).toBeEnabled();
    const requests = proof.stats().mediaRequests;
    await page.getByRole("button", { name: "+1 second", exact: true }).click();
    await expect(page.locator("video")).toHaveJSProperty("currentTime", 1);
    await expect(save).toBeEnabled();
    expect(proof.stats().mediaRequests).toBe(requests);
    await page.getByLabel("Review notes").fill("Good line through the port");
    await page.screenshot({
      path: test.info().outputPath("coaching-scrubber.png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await save.click();
    await expect(page.locator("body")).toHaveAttribute("data-saved", "yes");
    expect(body).toMatchObject({
      shotId: null,
      playerId: "alex",
      review: {
        gameId,
        audience: "player",
        notes: "Good line through the port",
        selectedAt: "2026-11-10T14:59:56.000Z",
      },
    });
    expect(JSON.stringify(body).length).toBeLessThan(1000);
    expect(body.review.video).toBeUndefined();
    await page
      .getByRole("button", { name: "Capture recent video", exact: true })
      .click();
    await expect(save).toBeEnabled();
    await page.getByLabel("Who should review this?").selectOption("team");
    await save.click();
    await expect(page.getByRole("status")).toContainText(
      "Flag saved for the team",
    );
    expect(body.playerId).toBeUndefined();
    expect(body.review.audience).toBe("team");
    expect(context.pages()).toHaveLength(1);
  } finally {
    proof.close();
  }
});
