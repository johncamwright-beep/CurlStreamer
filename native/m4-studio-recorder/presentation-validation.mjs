// Isolated real OBS/browser/encoder proof. Uses only a local HTTP fixture and
// MKV, never provider credentials or a public broadcast. RTMP receipt is not
// claimed: the production publisher shares these same program encoders.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [inputHost, inputRuntime, ffmpeg, evidenceRoot] = process.argv.slice(2);
assert(inputHost && inputRuntime && ffmpeg && evidenceRoot);
const host = resolve(inputHost),
  runtime = resolve(inputRuntime);
const evidence = join(resolve(evidenceRoot), randomUUID());
await mkdir(evidence, { recursive: true });
const recording = join(evidence, "presentation.mkv");
let mode = "live";
const logo = await readFile(
  new URL("../../public/branding/curlstreamer-logo.png", import.meta.url),
);
const server = createServer((req, res) => {
  res.setHeader("cache-control", "no-store");
  if (req.url === "/mode") {
    res.end(mode);
    return;
  }
  if (req.url === "/logo") {
    res.setHeader("content-type", "image/png");
    res.end(logo);
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(`<!doctype html><style>body{margin:0;background:#00c040;color:white;font:64px system-ui;text-align:center}img{height:240px;object-fit:contain}#marker{position:fixed;bottom:0;right:0;width:12px;height:12px}</style><img src="/logo"><h1 id="label">Original program</h1><div id="marker"></div><script>
  const audio=new AudioContext({sampleRate:48000}),osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=440;gain.gain.value=.12;osc.connect(gain);gain.connect(audio.destination);osc.start();audio.resume();
  setInterval(async()=>{const mode=await(await fetch('/mode')).text();document.body.style.background=mode==='live'?'#00c040':mode==='hold'?'#071320':'#241436';document.getElementById('label').textContent=mode==='live'?'Original program':mode==='hold'?'Stream temporarily off':'Game over — Home 5 – 3 Away';},100);
  let bright=false;setInterval(()=>{bright=!bright;document.getElementById('marker').style.background=bright?'#282828':'#080808'},500);
  </script>`);
});
await new Promise((resolveListen) =>
  server.listen(0, "127.0.0.1", resolveListen),
);
const child = spawn(
  host,
  [
    "--parent-pid",
    String(process.pid),
    "--runtime",
    runtime,
    "--recording",
    recording,
    "--program-cache",
    join(evidence, `curlstreamer-m4-cef-${"f".repeat(32)}`),
    "--webrtc-ip-handling-policy=default",
    "--disable-features=WebRtcHideLocalIpsWithMdns",
    "--program-control",
    "--presentation-control",
  ],
  {
    cwd: dirname(host),
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: `${runtime};${process.env.SystemRoot}/System32`,
    },
  },
);
const closed = new Promise((resolveExit, reject) => {
  child.once("error", reject);
  child.once("exit", resolveExit);
});
let incoming = Buffer.alloc(0),
  waiter;
child.stdout.on("data", (chunk) => {
  incoming = Buffer.concat([incoming, chunk]);
  waiter?.();
});
async function exact(length) {
  const until = Date.now() + 15000;
  while (incoming.length < length) {
    assert(Date.now() < until, "native receipt timeout");
    await new Promise((resolveWait) => {
      waiter = resolveWait;
      setTimeout(resolveWait, 50);
    });
  }
  const bytes = incoming.subarray(0, length);
  incoming = incoming.subarray(length);
  return bytes;
}
let id = 0;
async function command(tag, length = 8) {
  const request = Buffer.alloc(8);
  request.write(tag);
  request.writeUInt32LE(++id, 4);
  child.stdin.write(request);
  const ack = await exact(length);
  assert.equal(ack.readUInt32LE(4), id);
  assert.equal(ack.subarray(0, 4).toString(), tag === "RFS1" ? "RFP1" : "RFA1");
  return ack;
}
async function decode(args) {
  const process = spawn(ffmpeg, ["-v", "error", ...args], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const chunks = [];
  process.stdout.on("data", (chunk) => chunks.push(chunk));
  assert.equal(
    await new Promise((resolveExit, reject) => {
      process.once("error", reject);
      process.once("exit", resolveExit);
    }),
    0,
  );
  return Buffer.concat(chunks);
}
try {
  const url = Buffer.from(`http://127.0.0.1:${server.address().port}/`);
  const startup = Buffer.alloc(4 + url.length);
  startup.writeUInt32LE(url.length);
  url.copy(startup, 4);
  child.stdin.write(startup);
  assert.deepEqual(
    await exact(14),
    Buffer.from([82, 69, 65, 68, 89, 10, 80, 67, 86, 49, 1, 0, 0, 0]),
  );
  await delay(2500);
  mode = "hold";
  await command("RFM1");
  const heldSize = (await stat(recording)).size;
  await delay(3000);
  assert(
    (await stat(recording)).size > heldSize,
    "encoded output advances while held",
  );
  await command("RFR1");
  await delay(2500); // source refresh retains desired hold + native mute
  const health = await command("RFS1", 24);
  assert.equal(health.readUInt32LE(20), 1);
  assert(health.readUInt32LE(8) > 0);
  assert(health.readUInt32LE(12) > 0);
  assert(health.readUInt32LE(16) < 2500);
  mode = "live";
  await command("RFU1");
  await delay(2500);
  mode = "ended";
  await command("RFM1");
  await delay(3000);
  child.stdin.end();
  assert.equal(await closed, 0);
  const frames = await decode([
    "-i",
    recording,
    "-vf",
    "fps=1,scale=192:108",
    "-pix_fmt",
    "rgb24",
    "-f",
    "rawvideo",
    "-",
  ]);
  const audio = await decode([
    "-i",
    recording,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "48000",
    "-f",
    "s16le",
    "-",
  ]);
  const timeline = [];
  for (let frame = 0; frame < frames.length / (192 * 108 * 3); frame++) {
    const at = frame * 192 * 108 * 3 + (100 * 192 + 5) * 3;
    const [r, g, b] = frames.subarray(at, at + 3);
    const picture =
      g > 100 && g > r * 2
        ? "live"
        : b > 35 && r > g
          ? "ended"
          : b > g && g > r
            ? "hold"
            : "startup";
    let square = 0,
      count = 0;
    for (
      let sample = Math.floor((frame + 0.25) * 48000);
      sample < Math.min(audio.length / 2, (frame + 0.75) * 48000);
      sample++
    ) {
      const value = audio.readInt16LE(sample * 2) / 32768;
      square += value * value;
      count++;
    }
    timeline.push({
      second: frame,
      picture,
      rms: count ? Math.sqrt(square / count) : 0,
    });
  }
  const stable = timeline.filter(
    (row, index) =>
      index > 0 &&
      index < timeline.length - 1 &&
      timeline[index - 1].picture === row.picture &&
      timeline[index + 1].picture === row.picture,
  );
  assert(
    stable.some((row) => row.picture === "live" && row.rms > 0.02),
    "live program has tone",
  );
  assert(
    stable.some((row) => row.picture === "hold" && row.rms < 0.002),
    "held card encodes silence",
  );
  assert(
    stable.some((row) => row.picture === "ended" && row.rms < 0.002),
    "closing card encodes silence",
  );
  const pictures = timeline.map((row) => row.picture).join(",");
  assert(
    /live.*hold.*live.*ended/.test(pictures),
    "original picture resumes before closing card",
  );
  await writeFile(
    join(evidence, "result.json"),
    JSON.stringify(
      {
        scope: "real native MKV encoders; no RTMP/provider receipt claimed",
        timeline,
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS presentation: native mute, decoded hold/outro, resume, advancing frames and watchdog; evidence ${evidence}`,
  );
} finally {
  if (child.exitCode === null) child.kill();
  server.close();
}
