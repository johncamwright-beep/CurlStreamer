// Offline installation smoke check. Never pairs a desktop or starts a broadcast.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
const [directory] = process.argv.slice(2);
assert.ok(directory, "Supply the assembled Studio directory.");
const root = resolve(directory);
const configuration = JSON.parse(
  await readFile(join(root, "studio.json"), "utf8"),
);
const profile = await mkdtemp(join(tmpdir(), "studio-clean-profile-"));
const child = spawn(
  join(root, "node/node.exe"),
  [
    join(root, "app/studio.mjs"),
    `${configuration.website}/games/11111111-1111-4111-8111-111111111111`,
  ],
  {
    windowsHide: true,
    shell: false,
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      SystemRoot: process.env.SystemRoot,
      LOCALAPPDATA: profile,
      TEMP: profile,
      TMP: profile,
      PATH: join(process.env.SystemRoot, "System32"),
    },
  },
);
const lines = createInterface({ input: child.stdout });
let closed = false;
const complete = new Promise((resolve, reject) => {
  child.once("exit", resolve);
  child.once("error", reject);
});
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => reject(new Error("Studio startup timed out.")),
    120000,
  );
  child.once("exit", () => {
    clearTimeout(timer);
    reject(new Error("Studio exited before startup."));
  });
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  lines.on("line", (line) => {
    if (line === "CLOSED") closed = true;
    if (line.startsWith("READY ")) {
      clearTimeout(timer);
      resolve(line.slice(6));
    }
    if (line === "START_FAILED") {
      clearTimeout(timer);
      reject(new Error("Studio startup validation failed."));
    }
  });
});
try {
  const address = await ready;
  assert.match(address, /^http:\/\/127\.0\.0\.1:\d+$/);
  const page = await fetch(address);
  const cookie = page.headers.get("set-cookie").split(";")[0];
  const headers = {
    cookie,
    origin: address,
    "content-type": "application/json",
  };
  const result = await fetch(`${address}/command`, {
    method: "POST",
    headers,
    body: '{"action":"check"}',
  });
  const state = await result.json();
  assert.equal(state.pc, "ready");
  assert.equal(state.pairing, "unpaired");
  assert.equal(state.program, "idle");
  assert.equal(state.broadcast, "unknown");
  child.stdin.end("close\n");
  assert.equal(await complete, 0);
  assert.equal(closed, true);
  console.log(
    "PASS: relocated bundle, empty profile, unarmed native PC check, graceful controller exit.",
  );
} finally {
  if (child.exitCode === null && !child.stdin.destroyed)
    child.stdin.end("close\n");
  lines.close();
}
