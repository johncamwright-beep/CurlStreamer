import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const output = resolve(
  process.env.LOCAL_LAB_OUTPUT || ".local-broadcast-private",
);
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ["tools/local-broadcast/server.mjs"], {
  env: { ...process.env, LOCAL_LAB_OUTPUT: output },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
try {
  await new Promise((done, reject) => {
    server.stdout.once("data", done);
    server.once("error", reject);
    server.once("exit", () => reject(Error("Helper exited before ready")));
  });
  const { keys, port } = JSON.parse(
    await readFile(join(output, "access.private.json")),
  );
  const base = `http://localhost:${port}`;
  assert.equal((await fetch(`${base}/poll`)).status, 401);
  assert.equal(
    (
      await fetch(`${base}/start`, {
        method: "POST",
        headers: { authorization: `Bearer ${keys.camera1}` },
        body: "{}",
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await fetch(`${base}/start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${keys.host}`,
          origin: "https://untrusted.invalid",
        },
        body: "{}",
      })
    ).status,
    403,
  );
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "--autoplay-policy=no-user-gesture-required",
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });
  const pages = {};
  for (const role of ["host", "camera1", "camera2"]) {
    const context = await browser.newContext({
      viewport: { width: 1360, height: 900 },
    });
    const page = await context.newPage();
    pages[role] = page;
    page.on("pageerror", (e) => console.log("Browser error:", e.message));
    await page.goto(`${base}/#${role}:${keys[role]}`);
  }
  for (const role of ["camera1", "camera2"])
    await pages[role].evaluate(() => window.lab.connectSynthetic());
  await pages.host.waitForFunction(
    () =>
      Object.values(window.lab.snapshot().peers).filter(
        (p) => p.state === "connected" && p.frames > 30,
      ).length === 2,
    { timeout: 25000 },
  );
  await pages.host.evaluate(() => window.lab.startOutput());
  await wait(20000);
  const before = await pages.host.evaluate(() => window.lab.snapshot());
  console.log("Two-camera snapshot:", JSON.stringify(before));
  assert.equal(before.peers.camera1.route, "direct");
  assert.equal(before.peers.camera2.route, "direct");
  await pages.camera1.evaluate(() => window.lab.disconnectCamera());
  await wait(4000);
  await pages.camera1.evaluate(() => window.lab.connectSynthetic());
  await pages.host.waitForFunction(
    () =>
      window.lab.snapshot().peers.camera1?.frames > 30 &&
      window.lab.snapshot().peers.camera1?.state === "connected",
    { timeout: 25000 },
  );
  await pages.host.locator("#home-score").fill("7");
  await wait(5000);
  await pages.host.screenshot({
    path: join(output, "host-preview.png"),
    fullPage: true,
  });
  await pages.host.evaluate(() => window.lab.endTest());
  await wait(1500);
  const response = await fetch(`${base}/poll`, {
    headers: { authorization: `Bearer ${keys.host}` },
  });
  const result = await response.json();
  assert.equal(result.state, "stopped");
  assert.equal(result.error, null);
  assert.ok(result.bytes > 100000);
  await pages.host.locator("#microphone").click();
  await pages.host.locator("#mic-enable").click();
  await pages.host.waitForFunction(() =>
    document
      .getElementById("audio-status")
      .textContent.startsWith("Audio enabled:"),
  );
  await pages.host.evaluate(() => window.lab.startOutput());
  await wait(6000);
  await pages.host.evaluate(() => window.lab.endTest());
  const audioResult = await (
    await fetch(`${base}/poll`, {
      headers: { authorization: `Bearer ${keys.host}` },
    })
  ).json();
  assert.equal(audioResult.state, "stopped");
  console.log("Fake computer audio output:", audioResult.outputFile);
  await writeFile(
    join(output, "smoke-result.json"),
    JSON.stringify(
      {
        checks: [
          "unauthorized rejected",
          "camera cannot start output",
          "cross-origin rejected",
          "two direct camera connections",
          "camera reconnect",
          "local encoded file finalized",
        ],
        snapshot: before,
        output: result.outputFile,
        audioOutput: audioResult.outputFile,
        bytes: result.bytes,
      },
      null,
      2,
    ),
  );
  console.log("Local lab smoke passed:", result.outputFile);
} finally {
  await browser?.close();
  server.kill();
}
