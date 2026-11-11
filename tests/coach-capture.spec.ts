import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const gameId = "11111111-1111-4111-8111-111111111111";
const appOrigin = "https://coach.example.test";
const capturedAt = "2026-11-10T15:00:00.000Z";

test("chooses a local flag start and retries only the same flag metadata", async ({
  page,
  context,
}) => {
  const bundle = await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import LocalFlagCapture from './src/app/curlcoach/LocalFlagCapture';
        createRoot(document.getElementById('root')).render(
          <form onSubmit={event => {event.preventDefault(); document.body.dataset.graded = 'yes'}}>
            <LocalFlagCapture gameId="${gameId}" defaultPlayerId="alex"
              players={[{id: 'alex', name: 'Alex'}, {id: 'sam', name: 'Sam'}]}
              onSaved={()=>document.body.dataset.saved='yes'}/>
          </form>
        );
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "flag-capture-fixture",
        setup(builder) {
          builder.onResolve(
            { filter: /^@\/lib\/curlcoach\/shot-flag-clip$/ },
            () => ({ path: "shot-flag-clip", namespace: "fixture" }),
          );
          builder.onLoad(
            { filter: /^shot-flag-clip$/, namespace: "fixture" },
            () => ({
              contents: `export async function captureShotFlagClip(gameId, signal) {
          const response = await fetch('/fixture-clip', { signal });
          return { video: await response.blob(), duration: 12, minimum: 0, capturedAt: "${capturedAt}" };
        }`,
            }),
          );
        },
      },
    ],
  });
  const css = await readFile("src/app/curlcoach/coach.css", "utf8");
  const media = await readFile(resolve("public/celebrations/cat-dance.mp4"));
  const writes: string[] = [];
  let mediaRequests = 0;
  await context.route(`${appOrigin}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === "/api/curlcoach/local-review") {
      writes.push(route.request().postData() ?? "");
      await route.fulfill(
        writes.length === 1
          ? { status: 503, json: { error: "Test save failure" } }
          : { json: { saved: true } },
      );
      return;
    }
    if (pathname === "/fixture-clip") {
      mediaRequests++;
      await route.fulfill({
        body: media,
        headers: {
          "content-type": "video/mp4",
          "content-length": String(media.length),
        },
      });
      return;
    }
    await route.fulfill({
      contentType: "text/html",
      body: `<html><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;background:#071521;color:#eaf3ff;font-family:Arial,sans-serif}${css}</style><div class="coach-workspace"><div class="coach-lab" id="root"></div></div><script>${bundle.outputFiles[0].text}</script></html>`,
    });
  });
  await page.goto(appOrigin);
  await expect(page.getByLabel("Laptop address")).toHaveCount(0);
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finalize Flag" })).toHaveCount(
    0,
  );
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("player");
  const player = page.getByRole("combobox", { name: "Player", exact: true });
  await player.selectOption("sam");

  const select = page.getByRole("button", {
    name: "Select Flag Start",
    exact: true,
  });
  await select.click();
  const picker = page.getByRole("dialog", { name: "Select Flag Start" });
  const choose = picker.getByRole("button", {
    name: "Choose Start Point",
    exact: true,
  });
  const video = picker.locator("video");
  await expect(video).toHaveAttribute("src", /^blob:/, { timeout: 15000 });
  await expect(choose).toBeEnabled();
  const slider = picker.getByRole("slider", { name: "Shot start" });
  const duration = await video.evaluate(
    (element: HTMLVideoElement) => element.duration,
  );
  const latest = Number(await slider.getAttribute("max"));
  expect(duration).toBeLessThan(12);
  expect(duration - latest).toBeCloseTo(0.05, 3);
  expect(Number(await slider.inputValue())).toBeCloseTo(latest, 3);
  await expect(slider).toHaveAttribute("aria-valuetext", "Newest frame");
  await picker.getByRole("button", { name: "Close Select Flag Start" }).click();
  await expect(page.locator(".shot-flag-video")).toHaveCount(0);
  await select.click();
  await expect(choose).toBeEnabled();
  expect(mediaRequests).toBe(2);
  await picker.getByRole("button", { name: "−1 second", exact: true }).click();
  await expect(slider).toHaveAttribute("aria-valuetext", "1.0 seconds back");
  await slider.fill("1");
  await expect(video).toHaveJSProperty("currentTime", 1);
  await expect(choose).toBeEnabled();
  await page.screenshot({
    path: test.info().outputPath("coaching-scrubber.png"),
  });
  await choose.click();
  await expect(picker).toBeHidden();
  await expect(page.getByText("Start point selected")).toBeVisible();
  expect(writes).toHaveLength(0);

  const audience = page.getByLabel("Flag audience");
  await audience.selectOption("");
  await expect(select).toBeHidden();
  await audience.selectOption("player");
  await select.click();
  await expect(video).toHaveJSProperty("currentTime", 1);
  await picker.getByRole("button", { name: "+1 second", exact: true }).click();
  await picker.getByRole("button", { name: "Close Select Flag Start" }).click();
  expect(mediaRequests).toBe(2);
  await page
    .getByLabel("Flag note (optional)")
    .fill("Good line through the port");
  const finalize = page.getByRole("button", {
    name: "Finalize Flag",
    exact: true,
  });
  await finalize.click();
  await expect(page.getByRole("status")).toContainText(
    "Your selection and note are kept",
  );
  await expect(page.getByLabel("Flag note (optional)")).toHaveValue(
    "Good line through the port",
  );
  await finalize.click();
  await expect(page.locator("body")).toHaveAttribute("data-saved", "yes");
  await expect(page.locator("body")).not.toHaveAttribute("data-graded", "yes");
  expect(writes[0]).toBe(writes[1]);
  const playerFlag = JSON.parse(writes[1]);
  expect(playerFlag).toMatchObject({
    shotId: null,
    playerId: "sam",
    review: {
      gameId,
      audience: "player",
      notes: "Good line through the port",
      selectedAt: new Date(
        Date.parse(capturedAt) - (duration - 1) * 1000,
      ).toISOString(),
    },
  });
  expect(writes[1].length).toBeLessThan(1000);
  expect(playerFlag.review.video).toBeUndefined();

  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  await expect(player).toHaveCount(0);
  await select.click();
  await expect(choose).toBeEnabled();
  await choose.click();
  await finalize.click();
  await expect(page.getByRole("status")).toContainText(
    "Flag saved for the team",
  );
  const teamFlag = JSON.parse(writes[2]);
  expect(teamFlag.playerId).toBeUndefined();
  expect(teamFlag.review.audience).toBe("team");
  expect(teamFlag.review.notes).toBe("");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(context.pages()).toHaveLength(1);
});
