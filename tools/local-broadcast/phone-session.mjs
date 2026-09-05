// Bounded private phone test. Starts no cloud compute and never selects YouTube.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require("@playwright/test");
const out = resolve(process.env.LOCAL_LAB_OUTPUT || ".local-broadcast-private");
if (!process.env.CLOUDFLARED_PATH) throw Error("CLOUDFLARED_PATH is required");
await mkdir(out, { recursive: true });
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const helper = spawn(process.execPath, ["tools/local-broadcast/server.mjs"], {
  env: { ...process.env, LOCAL_LAB_OUTPUT: out },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let browser, tunnel, page;
let cancelled = false;
process.on("SIGINT", () => {
  cancelled = true;
});
process.on("SIGTERM", () => {
  cancelled = true;
});
try {
  await new Promise((done, reject) => {
    helper.stdout.once("data", done);
    helper.once("error", reject);
    helper.once("exit", () => reject(Error("Helper failed to start")));
  });
  const { port, keys } = JSON.parse(
    await readFile(join(out, "access.private.json")),
  );
  const base = `http://localhost:${port}`;
  tunnel = spawn(
    process.env.CLOUDFLARED_PATH,
    ["tunnel", "--url", `http://127.0.0.1:${port}`, "--no-autoupdate"],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  const publicUrl = await new Promise((done, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Private test tunnel did not start")),
      45000,
    );
    tunnel.once("error", reject);
    tunnel.stderr.on("data", (data) => {
      void appendFile(join(out, "tunnel.log"), data);
      const match = String(data).match(
        /https:\/\/[a-z0-9-]+\.trycloudflare\.com/,
      );
      if (match) {
        clearTimeout(timeout);
        done(match[0]);
      }
    });
  });
  await writeFile(join(out, "endpoint.json"), JSON.stringify({ publicUrl }));
  // Assert camera authorization and host isolation through the actual HTTPS tunnel.
  let ready = false;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    try {
      ready = (
        await fetch(`${publicUrl}/poll`, {
          headers: { authorization: `Bearer ${keys.camera1}` },
          signal: AbortSignal.timeout(4000),
        })
      ).ok;
    } catch {
      /* Tunnel DNS may still be propagating. */
    }
    if (!ready) await wait(2000);
  }
  if (!ready) throw Error("Phone link not reachable");
  let denied;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      denied = await fetch(`${publicUrl}/poll`, {
        headers: { authorization: `Bearer ${keys.host}` },
        signal: AbortSignal.timeout(4000),
      });
      break;
    } catch {
      await wait(2000);
    }
  }
  if (denied?.status !== 403)
    throw Error("Host control isolation check failed");
  const cameraSignal = await fetch(`${publicUrl}/signal`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${keys.camera1}`,
      origin: publicUrl,
      "content-type": "application/json",
    },
    body: JSON.stringify({ to: "host", data: { type: "bye" } }),
  });
  if (!cameraSignal.ok) throw Error("Phone signaling unavailable");
  browser = await chromium.launch({
    ...(process.platform === "win32" ? { channel: "msedge" } : {}),
    headless: true,
    args: [
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });
  page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  await page.goto(`${base}/#host:${keys.host}`);
  const deadline = Date.now() + 45 * 60_000;
  await writeFile(
    join(out, "phone-links.private.json"),
    JSON.stringify({
      expires: new Date(deadline).toISOString(),
      camera1: `${publicUrl}/#camera1:${keys.camera1}`,
      camera2: `${publicUrl}/#camera2:${keys.camera2}`,
      recording:
        "Starts automatically when a camera connects; silent audio; local file only; stops after 10 minutes.",
    }),
    { mode: 0o600 },
  );
  console.log(
    "Private phone links ready. Waiting for cameras; local recording only, maximum 10 minutes.",
  );
  let started = 0;
  while (!cancelled && Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.lab.snapshot());
    if (
      !started &&
      Object.values(snapshot.peers).some(
        (p) => p.state === "connected" && p.frames > 30,
      )
    ) {
      await page.evaluate(() => window.lab.startOutput());
      started = Date.now();
      console.log("Phone connected. Local recording started; microphone off.");
    }
    if (started) {
      await writeFile(
        join(out, "phone-metrics.json"),
        JSON.stringify(snapshot),
      );
      if (
        Date.now() - started >= 10 * 60_000 ||
        snapshot.recording === "inactive"
      )
        break;
    }
    await wait(2000);
  }
  await page.evaluate(() => window.lab.endTest());
  await writeFile(
    join(out, "session-finished.json"),
    JSON.stringify({
      recorded: Boolean(started),
      seconds: started ? (Date.now() - started) / 1000 : 0,
    }),
  );
  console.log("Private phone session finished. Helper and tunnel are closing.");
} finally {
  if (page) await page.evaluate(() => window.lab.endTest()).catch(() => {});
  await browser?.close();
  tunnel?.kill();
  helper.kill();
}
