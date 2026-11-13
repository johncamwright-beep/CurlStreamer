// Real local HTTP and Edge UI; program, desktop and stream are synthetic fixtures.
import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createM4OperatorServer } from "../src/lib/providers/m4-operator-server";
import type { M4DesktopClient } from "../src/lib/providers/m4-desktop-client";

const directory = await mkdtemp(join(tmpdir(), "m4-operator-ui-"));
const browser = await chromium.launch({ channel: "msedge", headless: true });
let app: Awaited<ReturnType<typeof createM4OperatorServer>> | undefined;
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const common = {
    gameId: "11111111-1111-4111-8111-111111111111",
    origin: "https://pilot.invalid",
    paths: {
      executable: "C:\\unused.exe",
      plugin: "C:\\unused.dll",
      runtime: "C:\\unused",
    },
    check: async () => undefined,
  };
  app = await createM4OperatorServer(common);
  await page.goto(app.address);
  await expect(
    page.getByRole("button", { name: "Start streaming", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("#streamStatus")).toContainText("disabled");
  await app.close();
  app = undefined;

  let paired = false;
  let state: "idle" | "armed" | "stopped" = "idle";
  let finalized = false;
  let finish!: (result: { finalized: boolean }) => void;
  const closed = new Promise<{ finalized: boolean }>((resolve) => {
    finish = resolve;
  });
  const desktop = {
    challenge: "synthetic-desktop-challenge",
    async exchange() {
      paired = true;
    },
    async stop() {
      paired = false;
    },
    snapshot: () => ({
      state: paired ? "active" : "stopped",
      authorized: paired,
    }),
    async heartbeat() {
      return { authorized: paired, desiredAction: "wait" };
    },
  } as unknown as M4DesktopClient;
  app = await createM4OperatorServer({
    ...common,
    desktop,
    pairingEnabled: true,
    streamingEnabled: true,
    program: {
      realtimeUrl: "https://realtime.invalid",
      realtimeKey: "synthetic-public-key",
      recorder: "C:\\unused.exe",
      runtime: "C:\\unused",
      recordingRoot: directory,
      cacheRoot: directory,
      rendererRoot: directory,
      streamPlugin: "C:\\unused.dll",
      async start() {
        return {
          closed,
          rendererAddress: "http://127.0.0.1:4000",
          async stop() {
            finalized = true;
            finish({ finalized: true });
          },
          stream: {
            async start() {
              state = "armed";
            },
            async stop() {
              state = "stopped";
              paired = false;
            },
            snapshot: () => ({
              state,
              localOutput: {
                state: state === "armed" ? "active" : "stopped",
                bytes: state === "armed" ? 2048 : 0,
              },
              ...(state === "armed"
                ? {
                    provider: {
                      streamStatus: "active",
                      healthStatus: "good",
                      broadcastStatus: "live",
                      broadcastLive: true,
                    },
                    liveConfirmed: true,
                  }
                : { liveConfirmed: false }),
            }),
          },
        };
      },
    },
  });
  await page.goto(app.address);
  await page.getByRole("button", { name: "Check this PC" }).click();
  await expect(page.locator("#status")).toContainText("passed");
  await page.getByLabel("Approval code").fill("c".repeat(43));
  await page.getByRole("button", { name: "Pair desktop", exact: true }).click();
  await expect(page.locator("#status")).toContainText("paired");
  await page
    .getByLabel("Private OBS source link or one-use code")
    .fill("i".repeat(43));
  await page
    .getByRole("button", { name: "Start program and recording" })
    .click();
  await expect(page.locator("#programStatus")).toContainText(
    "recording is active",
  );
  await page
    .getByRole("button", { name: "Start streaming", exact: true })
    .click();
  await expect(page.locator("#streamStatus")).toContainText(
    "YouTube reception and live broadcast confirmed",
  );
  await expect(page.locator("#localOutput")).toHaveText(
    "Local output: Active (2048 bytes)",
  );
  await expect(page.locator("#youtubeReception")).toHaveText(
    "YouTube reception: Confirmed",
  );
  await expect(page.locator("#broadcastStatus")).toHaveText("Broadcast: Live");
  await page.route("**/state", (route) => route.abort());
  await expect(page.locator("#broadcastStatus")).toHaveText(
    "Broadcast: Unknown",
  );
  await expect(page.locator("#youtubeReception")).toHaveText(
    "YouTube reception: Unknown",
  );
  await page.unroute("**/state");
  await expect(page.locator("#broadcastStatus")).toHaveText("Broadcast: Live");
  const sizing = await page
    .locator("button:visible,input:visible")
    .evaluateAll((elements) => ({
      count: elements.length,
      allAccessible: elements.every(
        (element) => element.getBoundingClientRect().height >= 44,
      ),
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth,
    }));
  expect(sizing.allAccessible).toBe(true);
  expect(sizing.noHorizontalOverflow).toBe(true);
  await page
    .getByRole("button", { name: "Stop streaming", exact: true })
    .click();
  await expect(page.locator("#streamStatus")).toContainText(
    "permission released",
  );
  await expect(page.locator("#programStatus")).toContainText(
    "recording is active",
  );
  expect(finalized).toBe(false);
  await expect(page.locator("#localOutput")).toHaveText(
    "Local output: Stopped",
  );
  await expect(page.locator("#youtubeReception")).toHaveText(
    "YouTube reception: Unknown",
  );
  await expect(page.locator("#broadcastStatus")).toHaveText(
    "Broadcast: Unknown",
  );
  await expect(
    page.getByRole("button", { name: "Start streaming", exact: true }),
  ).toBeDisabled();
  if (process.env.CURLCAST_TEST_SCREENSHOT)
    await page.screenshot({
      path: process.env.CURLCAST_TEST_SCREENSHOT,
      fullPage: true,
    });
  await page
    .getByRole("button", { name: "Stop and finalize recording" })
    .click();
  await expect(page.locator("#programStatus")).toHaveText(
    "Recording finalized.",
  );
  expect(finalized).toBe(true);
  expect(pageErrors).toEqual([]);
  console.log(
    JSON.stringify({
      fixture: "synthetic program/stream; real HTTP and Edge",
      mobileWidth: 390,
      ...sizing,
      independentStop: true,
      finalized: true,
    }),
  );
} finally {
  await app?.close();
  await browser.close();
  if (
    dirname(resolve(directory)) !== resolve(tmpdir()) ||
    !basename(directory).startsWith("m4-operator-ui-")
  )
    throw new Error("Invalid test cleanup path");
  await rm(directory, { recursive: true, force: true });
}
