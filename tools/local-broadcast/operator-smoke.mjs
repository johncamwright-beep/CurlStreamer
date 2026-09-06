// Exercises the actual automatic phone-session controller, not just MediaRecorder.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const { chromium } = createRequire(import.meta.url)("@playwright/test");
const out = resolve(process.env.LOCAL_LAB_OUTPUT || ".local-broadcast-private");
await mkdir(out, { recursive: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const operator = spawn(
  process.execPath,
  ["tools/local-broadcast/phone-session.mjs"],
  {
    env: {
      ...process.env,
      LOCAL_LAB_OUTPUT: out,
      LOCAL_LAB_RECORD_SECONDS: "12",
      LOCAL_LAB_LOOPBACK_TEST: "1",
      LOCAL_LAB_PORT: "4320",
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
operator.stderr.on("data", (data) => process.stderr.write(data));
let browser, exitCode;
const exit = new Promise((done) =>
  operator.once("exit", (code) => {
    exitCode = code;
    done();
  }),
);
try {
  let ready = false;
  operator.stdout.on("data", (data) => {
    if (String(data).includes("Private phone links ready")) ready = true;
  });
  for (let i = 0; i < 120 && !ready && exitCode === undefined; i++)
    await wait(1000);
  assert.ok(ready, "Automatic phone controller must start");
  const { port, keys } = JSON.parse(
    await readFile(join(out, "access.private.json")),
  );
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  const camera = await browser.newPage();
  await camera.goto(`http://localhost:${port}/#camera1:${keys.camera1}`);
  await camera.evaluate(() => window.lab.connectSynthetic());
  let observedRecording = false;
  for (let i = 0; i < 30 && exitCode === undefined; i++) {
    try {
      const metrics = JSON.parse(
        await readFile(join(out, "phone-metrics.json")),
      );
      if (metrics.recording === "recording" && metrics.elapsed >= 4)
        observedRecording = true;
    } catch {
      /* No output until the camera connects. */
    }
    await wait(1000);
  }
  await Promise.race([exit, wait(10000)]);
  assert.equal(exitCode, 0, "Controller should finish cleanly");
  const finished = JSON.parse(
    await readFile(join(out, "session-finished.json")),
  );
  assert.ok(
    observedRecording,
    "Recording must survive the initial inactive snapshot",
  );
  assert.ok(
    finished.recorded && finished.seconds >= 12 && finished.seconds < 25,
    "Configured duration must be reached",
  );
  await writeFile(
    join(out, "operator-result.json"),
    JSON.stringify({ observedRecording, ...finished }),
  );
  console.log(
    "Automatic operator regression passed:",
    JSON.stringify(finished),
  );
} finally {
  await browser?.close();
  if (exitCode === undefined) operator.kill();
}
