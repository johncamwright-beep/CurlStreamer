import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { createM4ProgramBridge } from "../src/lib/providers/m4-program-bridge";
import type { M4ProgramClient } from "../src/lib/providers/m4-program-client";
import { startM4StudioRecorder } from "../src/lib/providers/m4-studio-recorder";
import type { CameraRole } from "../src/lib/m2-studio-protocol";

const connected: CameraRole[] = [];
const attempts: Record<CameraRole, number> = {
  "camera-home": 0,
  "camera-away": 0,
};
const client: Pick<M4ProgramClient, "readGame" | "action" | "close"> = {
  close() {},
  async action() {
    return { ok: true };
  },
  async readGame() {
    return {
      id: "11111111-1111-4111-8111-111111111111",
      config: {
        eventName: "Renderer integration check",
        homeName: "North",
        awayName: "South",
        homeColor: "#0891b2",
        awayColor: "#dc2626",
      },
      score: {
        hammer: "home" as const,
        totals: { home: 4, away: 3 },
        currentEnd: 6,
      },
      layout: "split" as const,
      broadcast: "idle" as const,
      audioMuted: true,
      cameraFraming: {
        "camera-home": "contain" as const,
        "camera-away": "contain" as const,
      },
      sponsors: [
        {
          id: "community",
          name: "Community Ice",
          altText: "Community Ice",
          dataUrl: "/sponsors/community.svg",
          enabled: true,
          rotation: 0,
        },
      ],
      sponsorMode: {
        active: true,
        style: "overlay" as const,
        intervalSeconds: 5,
        startedAt: Date.now(),
        rotationOffset: 0,
        paused: false,
      },
    };
  },
};
const realtime = {
  async connect(cameraRole: CameraRole) {
    attempts[cameraRole]++;
    if (attempts[cameraRole] === 1) throw new Error("camera not ready");
    connected.push(cameraRole);
    return {
      cameraRole,
      sessionId: "22222222-2222-4222-8222-222222222222",
      generation: 1,
      negotiationId:
        cameraRole === "camera-home"
          ? "33333333-3333-4333-8333-333333333333"
          : "44444444-4444-4444-8444-444444444444",
      assignmentGeneration: 1,
      expiresAt: Date.now() + 10_000,
    };
  },
  async drain() {
    return [];
  },
  async close() {},
};

const bridge = await createM4ProgramBridge(client, realtime);
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
  });
  const errors: string[] = [];
  let expectedWaitingResponses = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("status of 409 (Conflict)")
    )
      errors.push(message.text());
  });
  page.on("response", (response) => {
    const path = new URL(response.url()).pathname;
    if (response.status() === 409 && path === "/camera")
      expectedWaitingResponses++;
    else if (response.status() >= 400)
      errors.push(`${response.status()} ${new URL(response.url()).pathname}`);
  });
  await page.goto(bridge.rendererUrl, { waitUntil: "domcontentloaded" });
  try {
    await page.getByTestId("broadcast-canvas").waitFor({ timeout: 10_000 });
  } catch {
    throw new Error(`renderer did not load: ${errors.join("; ")}`);
  }
  await page.getByText("North", { exact: true }).waitFor();
  await page.getByText("South", { exact: true }).waitFor();
  await page.getByAltText("Community Ice").waitFor();
  await page.waitForFunction(() =>
    document.body.textContent?.includes("Verifying direct path"),
  );
  if (errors.length)
    throw new Error(`renderer page errors: ${errors.join("; ")}`);
  if (
    !(["camera-home", "camera-away"] as const).every((role) =>
      connected.includes(role),
    )
  )
    throw new Error("both renderer cameras did not request connections");
  if (expectedWaitingResponses !== 2)
    throw new Error(
      "renderer did not retry both initially unavailable cameras",
    );
  process.stdout.write("M4 program renderer browser check passed.\n");
} finally {
  await browser.close();
  await bridge.close();
}

const recorderExecutable = process.env.CURLCAST_TEST_RECORDER_HOST;
const obsRuntime = process.env.CURLCAST_TEST_OBS_RUNTIME;
const ffmpeg = process.env.CURLCAST_TEST_FFMPEG;
if (recorderExecutable && obsRuntime && ffmpeg) {
  const nativeBridge = await createM4ProgramBridge(client, realtime);
  const directory = await mkdtemp(join(tmpdir(), "m4-private-renderer-"));
  const recording = join(directory, "private-program.mkv");
  try {
    const recorder = await startM4StudioRecorder({
      executable: recorderExecutable,
      runtime: obsRuntime,
      recording,
      program: {
        url: nativeBridge.rendererUrl,
        cacheDirectory: join(directory, "private-cef-cache"),
      },
    });
    await delay(6500);
    await recorder.stop();
    const { stdout } = await promisify(execFile)(
      ffmpeg,
      [
        "-xerror",
        "-v",
        "error",
        "-ss",
        "5",
        "-i",
        recording,
        "-frames:v",
        "1",
        "-pix_fmt",
        "rgb24",
        "-f",
        "rawvideo",
        "-",
      ],
      {
        encoding: "buffer",
        maxBuffer: 8 * 1024 * 1024,
        timeout: 15_000,
        windowsHide: true,
      },
    );
    if (stdout.length !== 1920 * 1080 * 3)
      throw new Error("native renderer frame dimensions were invalid");
    let visibleSamples = 0;
    for (let offset = 0; offset < stdout.length; offset += 4096 * 3) {
      if (stdout[offset] + stdout[offset + 1] + stdout[offset + 2] > 30)
        visibleSamples++;
    }
    if (visibleSamples < 100)
      throw new Error("native renderer produced a blank frame");
    process.stdout.write(
      "M4 private renderer OBS/CEF recording check passed.\n",
    );
  } finally {
    await nativeBridge.close();
    await rm(directory, { recursive: true, force: true });
  }
}
