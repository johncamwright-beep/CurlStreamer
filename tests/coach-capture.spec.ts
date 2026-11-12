import { test, expect, type Page, type Route } from "@playwright/test";
import { build } from "esbuild";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const gameId = "11111111-1111-4111-8111-111111111111";
const appOrigin = "https://coach.example.test";
const capturedAt = "2026-11-10T15:00:00.000Z";

async function captureFixture(
  page: Page,
  onClip?: (route: Route, attempt: number) => Promise<boolean>,
  clipDuration = 12,
) {
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
          return { video: await response.blob(), duration: ${clipDuration}, minimum: 0, capturedAt: "${capturedAt}" };
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
  await page.route(`${appOrigin}/**`, async (route) => {
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
      if (await onClip?.(route, mediaRequests)) return;
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
  return { writes, mediaRequests: () => mediaRequests };
}

function startPicker(page: Page) {
  const select = page.getByRole("button", {
    name: "Select Flag Start",
    exact: true,
  });
  const picker = page.getByRole("dialog", { name: "Select Flag Start" });
  const choose = picker.getByRole("button", {
    name: "Choose Start Point",
    exact: true,
  });
  return { select, picker, choose, video: picker.locator("video") };
}

test("chooses a local flag start and retries only the same flag metadata", async ({
  page,
  context,
}) => {
  const { writes, mediaRequests } = await captureFixture(page);
  await expect(page.getByLabel("Laptop address")).toHaveCount(0);
  await expect(page.getByLabel("Pairing code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Finalize Flag" })).toHaveCount(
    0,
  );
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await expect.poll(mediaRequests).toBe(1);
  await page.getByLabel("Flag audience").selectOption("player");
  const player = page.getByRole("combobox", { name: "Player", exact: true });
  await player.selectOption("sam");

  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(video).toHaveAttribute("src", /^blob:/, { timeout: 15000 });
  await expect(choose).toBeEnabled();
  expect(mediaRequests()).toBe(1);
  const slider = picker.getByRole("slider", { name: "Shot start" });
  const duration = await video.evaluate(
    (element: HTMLVideoElement) => element.duration,
  );
  const latest = Number(await slider.getAttribute("max"));
  expect(duration).toBeLessThan(12);
  expect(duration - latest).toBeCloseTo(0.5, 3);
  expect(Number(await slider.inputValue())).toBeCloseTo(latest, 3);
  await expect(slider).toHaveAttribute("aria-valuetext", "Newest frame");
  await picker.getByRole("button", { name: "Close Select Flag Start" }).click();
  await expect(page.locator(".shot-flag-video")).toHaveCount(0);
  await select.click();
  await expect(choose).toBeEnabled();
  expect(mediaRequests()).toBe(2);
  await picker
    .getByRole("button", { name: "−0.25 seconds", exact: true })
    .click();
  await expect(slider).toHaveAttribute("aria-valuetext", "0.25 seconds back");
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
  await picker
    .getByRole("button", { name: "+0.25 seconds", exact: true })
    .click();
  await picker.getByRole("button", { name: "Close Select Flag Start" }).click();
  expect(mediaRequests()).toBe(2);
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

test("fine scrubbing keeps the last drag position and exposes the full clip", async ({
  page,
  context,
}, testInfo) => {
  // Map the short fixture's real decoding and seek events onto two minutes.
  await page.addInitScript(() => {
    const media = HTMLMediaElement.prototype;
    const duration = Object.getOwnPropertyDescriptor(media, "duration")!;
    const currentTime = Object.getOwnPropertyDescriptor(media, "currentTime")!;
    Object.defineProperty(media, "duration", {
      ...duration,
      get(this: HTMLMediaElement) {
        const seconds = duration.get!.call(this);
        return Number.isFinite(seconds) ? 120 : seconds;
      },
    });
    Object.defineProperty(media, "currentTime", {
      ...currentTime,
      get(this: HTMLMediaElement) {
        return (currentTime.get!.call(this) * 120) / duration.get!.call(this);
      },
      set(this: HTMLMediaElement, seconds: number) {
        currentTime.set!.call(this, (seconds * duration.get!.call(this)) / 120);
      },
    });
  });
  const { writes } = await captureFixture(page, undefined, 120);
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(choose).toBeEnabled();
  const slider = picker.getByRole("slider", { name: "Shot start" });
  const latest = Number(await slider.getAttribute("max"));
  await expect(slider).toHaveAttribute("min", String(latest - 20));

  await slider.scrollIntoViewIfNeeded();
  const box = (await slider.boundingBox())!;
  const input = await context.newCDPSession(page);
  const y = box.y + box.height / 2;
  const startX = box.x + box.width * 0.7;
  const movedX = box.x + box.width * 0.45;
  const touch = testInfo.project.name === "phone";
  if (touch) {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: startX, y }],
    });
    await input.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: movedX, y }],
    });
  } else {
    await input.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x: startX,
      y,
      button: "left",
      buttons: 1,
      clickCount: 1,
    });
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: movedX,
      y,
      button: "left",
      buttons: 1,
    });
  }
  await expect
    .poll(async () => Number(await slider.inputValue()))
    .toBeLessThan(latest - 6);
  const dragged = await slider.inputValue();
  if (touch) {
    await input.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
  } else {
    await input.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x: box.x + box.width * 0.85,
      y,
      button: "left",
      buttons: 0,
      clickCount: 1,
    });
  }
  await expect(slider).toHaveValue(dragged);
  await expect(choose).toBeEnabled();

  // A late media event can report an earlier seek after the thumb is lifted.
  await video.evaluate((element: HTMLVideoElement) => {
    Object.defineProperty(element, "currentTime", {
      configurable: true,
      value: element.currentTime - 3,
    });
    element.dispatchEvent(new Event("timeupdate"));
    Reflect.deleteProperty(element, "currentTime");
  });
  await expect(slider).toHaveValue(dragged);
  await picker.getByRole("button", { name: "Full clip", exact: true }).click();
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveValue(dragged);
  await slider.fill("25");
  await picker.getByRole("button", { name: "Fine scrub", exact: true }).click();
  await expect(slider).toHaveAttribute("min", "15");
  await expect(slider).toHaveAttribute("max", "35");
  await expect(slider).toHaveValue("25");

  await picker
    .getByRole("button", { name: "+0.25 seconds", exact: true })
    .click();
  await expect(choose).toBeEnabled();
  const selected = Number(await slider.inputValue());
  expect(selected).toBeCloseTo(25.25, 2);
  await choose.click();
  await page
    .getByRole("button", { name: "Finalize Flag", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  const savedAt = Date.parse(JSON.parse(writes[0]).review.selectedAt);
  expect(
    Math.abs(savedAt - (Date.parse(capturedAt) - (120 - selected) * 1000)),
  ).toBeLessThanOrEqual(1);
});

test("a stalled seek near the end falls back on the same clip", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() => {
    const media = HTMLMediaElement.prototype;
    const currentTime = Object.getOwnPropertyDescriptor(media, "currentTime")!;
    const seeking = Object.getOwnPropertyDescriptor(media, "seeking")!;
    const stalled = new WeakMap<HTMLMediaElement, number>();
    Object.defineProperty(media, "currentTime", {
      ...currentTime,
      get(this: HTMLMediaElement) {
        return stalled.get(this) ?? currentTime.get!.call(this);
      },
      set(this: HTMLMediaElement, value: number) {
        if (value > this.duration - 1 && !this.dataset.tailSeekStalled) {
          this.dataset.tailSeekStalled = "yes";
          this.dataset.frameDecodedBeforeSeek = String(this.readyState >= 2);
          stalled.set(this, value);
          return;
        }
        stalled.delete(this);
        currentTime.set!.call(this, value);
      },
    });
    Object.defineProperty(media, "seeking", {
      ...seeking,
      get(this: HTMLMediaElement) {
        return stalled.has(this) || seeking.get!.call(this);
      },
    });
  });
  const { mediaRequests } = await captureFixture(page);
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(video).toHaveAttribute("src", /^blob:/);
  const url = await video.getAttribute("src");
  await expect(video).toHaveAttribute("data-tail-seek-stalled", "yes");
  await expect(video).toHaveAttribute("data-frame-decoded-before-seek", "true");
  await expect(choose).toBeDisabled();
  await page.clock.fastForward(2_000);
  await expect(choose).toBeEnabled();
  await expect(picker.getByRole("status")).toHaveCount(0);
  await expect(video).toHaveAttribute("src", url!);
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.currentTime),
  ).toBeLessThan(1);
  expect(mediaRequests()).toBe(1);
  await choose.click();
  await expect(page.getByText("Start point selected")).toBeVisible();
});

test("reload requests a fresh clip from a working picker and keeps the flag note", async ({
  page,
}) => {
  const { mediaRequests } = await captureFixture(page);
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(choose).toBeEnabled();
  const first = await video.getAttribute("src");
  await choose.click();
  await page.getByLabel("Flag note (optional)").fill("Watch the takeout");

  await select.click();
  await expect(video).toHaveAttribute("src", first!);
  await picker.getByRole("button", { name: "Reload recent video" }).click();
  await expect(choose).toBeEnabled();
  await expect(video).not.toHaveAttribute("src", first!);
  expect(mediaRequests()).toBe(2);
  await choose.click();
  await expect(page.getByLabel("Flag note (optional)")).toHaveValue(
    "Watch the takeout",
  );
});

test("a browser that blocks autoplay can load the same clip with a tap", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const media = HTMLMediaElement.prototype;
    const play = media.play;
    const readyState = Object.getOwnPropertyDescriptor(media, "readyState")!;
    let playCalls = 0;
    Object.defineProperty(media, "readyState", {
      ...readyState,
      get(this: HTMLMediaElement) {
        const state = readyState.get!.call(this);
        return playCalls < 2 ? Math.min(state, 1) : state;
      },
    });
    media.play = function () {
      playCalls++;
      if (playCalls === 1)
        return Promise.reject(
          new DOMException("Playback needs a tap", "NotAllowedError"),
        );
      return play.call(this).then(() => {
        this.dispatchEvent(new Event("loadeddata"));
      });
    };
  });
  const { mediaRequests } = await captureFixture(page);
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(video).toHaveAttribute("src", /^blob:/);
  const url = await video.getAttribute("src");
  await expect(choose).toBeDisabled();
  await picker.getByRole("button", { name: "Tap to load video" }).click();
  await expect(choose).toBeEnabled();
  await expect(video).toHaveAttribute("src", url!);
  expect(mediaRequests()).toBe(1);
});

test("an invalid clip waits for an explicit reload before transferring again", async ({
  page,
}) => {
  const { mediaRequests } = await captureFixture(
    page,
    async (route, attempt) => {
      if (attempt !== 1) return false;
      await route.fulfill({ body: "corrupt video", contentType: "video/mp4" });
      return true;
    },
  );
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose } = startPicker(page);
  await select.click();
  await expect(picker.getByRole("alert")).toContainText("Video could not play");
  await expect(choose).toBeDisabled();
  expect(mediaRequests()).toBe(1);
  await picker.getByRole("button", { name: "Reload recent video" }).click();
  await expect(choose).toBeEnabled();
  expect(mediaRequests()).toBe(2);
});

test("retries one failed transfer and cancels the retry when the picker closes", async ({
  page,
}) => {
  let finishRetry!: () => void;
  const retry = new Promise<void>((resolve) => (finishRetry = resolve));
  const { mediaRequests } = await captureFixture(
    page,
    async (route, attempt) => {
      if (attempt === 1) {
        await route.abort();
        return true;
      }
      if (attempt === 2) {
        await retry;
        await route.abort();
        return true;
      }
      return false;
    },
  );
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose, video } = startPicker(page);
  await select.click();
  await expect(picker.getByRole("status")).toHaveText("Retrying recent video…");
  await expect.poll(mediaRequests).toBe(2);
  await expect(choose).toBeDisabled();
  await picker.getByRole("button", { name: "Close Select Flag Start" }).click();
  await expect(picker).toBeHidden();
  finishRetry();
  await expect(video).toHaveCount(0);
  expect(mediaRequests()).toBe(2);
  await select.click();
  await expect(choose).toBeEnabled();
  expect(mediaRequests()).toBe(3);
});

test("a transfer timeout offers reload without starting another long transfer", async ({
  page,
}) => {
  await page.clock.install();
  let finishTransfer!: () => void;
  const transfer = new Promise<void>((resolve) => (finishTransfer = resolve));
  const { mediaRequests } = await captureFixture(
    page,
    async (route, attempt) => {
      if (attempt !== 1) return false;
      await transfer;
      await route.abort();
      return true;
    },
  );
  await page.getByLabel("Flag shot for review").selectOption("yes");
  await page.getByLabel("Flag audience").selectOption("team");
  const { select, picker, choose } = startPicker(page);
  await select.click();
  await expect.poll(mediaRequests).toBe(1);
  await expect(picker.getByRole("status")).toHaveText("Loading recent video…");
  await page.clock.fastForward(75_100);
  await expect(picker.getByRole("alert")).toHaveText(
    "Recent video took too long to load.",
  );
  finishTransfer();
  expect(mediaRequests()).toBe(1);
  await picker.getByRole("button", { name: "Reload recent video" }).click();
  await expect(choose).toBeEnabled();
  expect(mediaRequests()).toBe(2);
});
