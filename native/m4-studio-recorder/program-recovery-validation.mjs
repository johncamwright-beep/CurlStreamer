import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
const [inputExecutable, inputRuntime] = process.argv.slice(2);
const executable = resolve(inputExecutable);
const runtime = resolve(inputRuntime);
assert(executable && runtime);
const directory = await mkdtemp(join(tmpdir(), "m4-program-recovery-"));
const recording = join(directory, "recovery.mkv");
let loads = 0;
const server = createServer((request, response) => {
  loads++;
  response.writeHead(200, {
    "content-type": "text/html",
    "cache-control": "no-store",
  });
  response.end(
    `<!doctype html><style>html,body{margin:0;width:100%;height:100%;background:#173245}#marker{position:fixed;bottom:0;right:0;width:12px;height:12px;z-index:2147483647;background:rgb(8,8,8)}</style><div id="marker"></div><script>let value=false;const timer=setInterval(()=>{value=!value;document.getElementById('marker').style.background=value?'rgb(40,40,40)':'rgb(8,8,8)'},500);setTimeout(()=>clearInterval(timer),4500);</script>`,
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "path"),
);
env.Path = runtime + ";" + (process.env.Path || process.env.PATH || "");
const child = spawn(
  executable,
  [
    "--parent-pid",
    String(process.pid),
    "--runtime",
    runtime,
    "--recording",
    recording,
    "--program-cache",
    join(directory, "curlstreamer-m4-cef-" + "a".repeat(32)),
    "--webrtc-ip-handling-policy=default",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--program-control",
  ],
  {
    cwd: dirname(executable),
    windowsHide: true,
    env,
    stdio: ["pipe", "pipe", "ignore"],
  },
);
const pid = child.pid;
let output = Buffer.alloc(0),
  exited = false;
const closed = new Promise((resolve) =>
  child.once("exit", (code) => {
    exited = true;
    resolve(code);
  }),
);
child.stdout.on("data", (chunk) => {
  output = Buffer.concat([output, chunk]);
  assert(output.length <= 4096);
});
child.stdin.on("error", () => {});
const bounded = async (test, ms = 10000) => {
  const end = Date.now() + ms;
  while (!test()) {
    assert(!exited, "native recorder exited");
    assert(Date.now() < end, "bounded wait expired");
    await delay(20);
  }
};
const url = Buffer.from(`http://127.0.0.1:${address.port}/`);
const bootstrap = Buffer.alloc(4 + url.length);
bootstrap.writeUInt32LE(url.length);
url.copy(bootstrap, 4);
child.stdin.write(bootstrap);
let requestId = 0;
const command = async (tag, length) => {
  assert(output.length === 0);
  const id = ++requestId;
  const frame = Buffer.alloc(8);
  frame.write(tag);
  frame.writeUInt32LE(id, 4);
  child.stdin.write(frame);
  await bounded(() => output.length >= length, 5000);
  const ack = output.subarray(0, length);
  output = output.subarray(length);
  assert.equal(ack.readUInt32LE(4), id);
  return ack;
};
const health = async () => {
  const ack = await command("RFS1", 24);
  assert.equal(ack.subarray(0, 4).toString(), "RFP1");
  return {
    sequence: ack.readUInt32LE(8),
    changes: ack.readUInt32LE(12),
    age: ack.readUInt32LE(16),
    active: ack.readUInt32LE(20),
  };
};
try {
  await bounded(() => output.length >= 6, 30000);
  assert.equal(output.subarray(0, 6).toString(), "READY\n");
  output = output.subarray(6);
  await delay(2000);
  const moving = await health();
  assert(
    moving.changes >= 2 && moving.age < 1500 && moving.active === 1,
    "actual marker did not advance",
  );
  await delay(5500);
  const frozen = await health();
  assert(
    frozen.age > 2000 &&
      frozen.sequence > moving.sequence &&
      frozen.active === 1,
    "static marker was not detected independently of OBS frames",
  );
  const before = (await stat(recording)).size;
  const ack = await command("RFR1", 8);
  assert.equal(ack.subarray(0, 4).toString(), "RFA1");
  await delay(2000);
  const recovered = await health();
  assert(
    recovered.changes > frozen.changes &&
      recovered.age < 1500 &&
      recovered.active === 1,
    "refresh did not recover actual browser painting",
  );
  assert.equal(child.pid, pid);
  assert(loads >= 2, "actual browser page was not reloaded");
  assert(
    (await stat(recording)).size > before,
    "recording did not continue through browser refresh",
  );
  child.stdin.end();
  assert.equal(
    await Promise.race([
      closed,
      delay(10000).then(() => {
        throw Error("native finalization timed out");
      }),
    ]),
    0,
  );
  console.log(
    JSON.stringify({
      result: "PASS",
      sameNativePid: true,
      markerAdvanced: true,
      stalePaintDetected: true,
      browserReloaded: true,
      paintRecovered: true,
      recordingContinued: true,
      finalized: true,
    }),
  );
} finally {
  if (!exited) {
    child.stdin.end();
    await Promise.race([closed, delay(10000)]);
    if (!exited) child.kill();
  }
  await new Promise((resolve) => server.close(resolve));
}
