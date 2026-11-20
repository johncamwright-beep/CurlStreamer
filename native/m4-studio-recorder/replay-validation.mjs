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
  setInterval(async()=>{const mode=await(await fetch('/mode')).text();osc.frequency.value=mode==='live'?440:880;document.body.style.background=mode==='live'?'#00c040':mode==='hold'?'#071320':'#241436';document.getElementById('label').textContent=mode==='live'?'Original program':mode==='hold'?'Stream temporarily off':'Game over — Home 5 – 3 Away';},100);
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
    "--replay-control",
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
async function command(tag, length = 8, start) {
  const request = Buffer.alloc(start === undefined ? 8 : 12);
  request.write(tag);
  request.writeUInt32LE(++id, 4);
  if (start !== undefined) request.writeUInt32LE(start, 8);
  child.stdin.write(request);
  const ack = await exact(length);
  assert.equal(ack.readUInt32LE(4), id);
  assert.equal(
    ack.subarray(0, 4).toString(),
    tag === "RFS1" ? "RFP1" : tag === "RPS1" ? "RPT1" : "RFA1",
  );
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
  assert.equal((await exact(22)).subarray(14, 18).toString(), "RPV1");
  const warmMs =
    process.env.REPLAY_VALIDATION_BUFFER_MS === "65000" ? 65000 : 6000;
  await delay(warmMs);
  await command("RPC1");
  let status;
  for (let attempt = 0; attempt < 40; attempt++) {
    status = await command("RPS1", 24);
    if (status.readUInt32LE(8) === 3) break;
    assert.notEqual(status.readUInt32LE(8), 7, "capture failed");
    await delay(250);
  }
  assert.equal(status.readUInt32LE(8), 3, "snapshot ready");
  const duration = status.readUInt32LE(12);
  assert(duration > 3000 && duration < (warmMs === 65000 ? 65000 : 15000));
  if (warmMs === 65000)
    assert(duration >= 60000, "full 60-second selection available");
  mode = "hold"; // New live picture: replay must retain the earlier green picture.
  await delay(1000);
  await command("RPP1", 8, Math.max(0, duration - 3000));
  await delay(1300);
  assert.equal(
    (await command("RPS1", 24)).readUInt32LE(8),
    5,
    "replay playing",
  );
  assert.equal(
    (await command("RFS1", 24)).readUInt32LE(20),
    1,
    "recording still active",
  );
  let returned;
  for (let attempt = 0; attempt < 32; attempt++) {
    await delay(250);
    returned = (await command("RPS1", 24)).readUInt32LE(8);
    if (returned <= 1 || returned === 7) break;
  }
  assert(returned <= 1, "automatic live return, state=" + returned);
  for (let attempt = 0; attempt < 32; attempt++) {
    if ((await command("RPS1", 24)).readUInt32LE(8) === 1) break;
    await delay(250);
  }
  await command("RPC1");
  for (let attempt = 0; attempt < 40; attempt++) {
    status = await command("RPS1", 24);
    if (status.readUInt32LE(8) === 3) break;
    await delay(250);
  }
  assert.equal(status.readUInt32LE(8), 3);
  await command("RPP1", 8, Math.max(0, status.readUInt32LE(12) - 2500));
  await delay(1300);
  await command("RPX1");
  await delay(1300);
  assert(
    (await command("RPS1", 24)).readUInt32LE(8) <= 1,
    "manual live return",
  );
  for (let attempt = 0; attempt < 32; attempt++) {
    if ((await command("RPS1", 24)).readUInt32LE(8) === 1) break;
    await delay(250);
  }
  await command("RPC1");
  for (let attempt = 0; attempt < 40; attempt++) {
    status = await command("RPS1", 24);
    if (status.readUInt32LE(8) === 3) break;
    await delay(250);
  }
  await command("RPP1", 8, Math.max(0, status.readUInt32LE(12) - 2500));
  await delay(1300);
  await command("RFM1"); // Pause/end presentation takes priority immediately.
  assert(
    (await command("RPS1", 24)).readUInt32LE(8) <= 1,
    "presentation overrides replay",
  );
  await command("RFU1");
  await delay(1000);
  child.stdin.end();
  assert.equal(await closed, 0);
  const frames = await decode([
    "-i",
    recording,
    "-vf",
    "fps=2,scale=32:18",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-",
  ]);
  assert(
    frames.length > 32 * 18 * 3 * 10,
    "recording decodes across replay transitions",
  );
  const audio = await decode([
    "-i",
    recording,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "8000",
    "-f",
    "f32le",
    "-",
  ]);
  const tones = [];
  // Decode short windows after warmup: both recorded and current audio must
  // contain intermediate gains, not just instantaneous full-volume switches.
  for (const frequency of [440, 880]) {
    const amplitudes = [];
    for (
      let offset = Math.ceil(warmMs / 50) * 1600;
      offset + 1600 <= audio.length;
      offset += 1600
    ) {
      let real = 0,
        imaginary = 0;
      for (let n = 0; n < 400; n++) {
        const value = audio.readFloatLE(offset + n * 4);
        real += value * Math.cos((n * 2 * Math.PI * frequency) / 8000);
        imaginary += value * Math.sin((n * 2 * Math.PI * frequency) / 8000);
      }
      amplitudes.push(Math.hypot(real, imaginary));
    }
    const peak = Math.max(...amplitudes);
    assert(
      peak > 1 &&
        amplitudes.filter((value) => value > peak * 0.15 && value < peak * 0.8)
          .length >= 4,
      `${frequency} Hz program audio has a gradual transition envelope`,
    );
  }
  for (let offset = 0; offset + 16000 <= audio.length; offset += 16000) {
    let e440 = 0,
      q440 = 0,
      e880 = 0,
      q880 = 0;
    for (let n = 0; n < 4000; n++) {
      const value = audio.readFloatLE(offset + n * 4);
      e440 += value * Math.cos((n * 2 * Math.PI * 440) / 8000);
      q440 += value * Math.sin((n * 2 * Math.PI * 440) / 8000);
      e880 += value * Math.cos((n * 2 * Math.PI * 880) / 8000);
      q880 += value * Math.sin((n * 2 * Math.PI * 880) / 8000);
    }
    const a = Math.hypot(e440, q440),
      b = Math.hypot(e880, q880);
    const tone = a > 10 && a > b * 3 ? 440 : b > 10 && b > a * 3 ? 880 : null;
    if (tone && tones.at(-1) !== tone) tones.push(tone);
  }
  assert.deepEqual(
    tones,
    [440, 880, 440, 880],
    "replay audio replaces live audio and returns to current audio",
  );
  let redBar = false,
    fullWash = false;
  for (let i = 0; i < frames.length; i += 1728) {
    const red = (offset) =>
      frames[i + offset] > 130 && frames[i + offset + 1] < 90;
    if (red(3) && red(90) && frames[i + 1357] > 150) redBar = true;
    if (red(3) && red(1356)) fullWash = true;
  }
  assert(redBar, "full-width red replay bar over captured program");
  assert(fullWash, "OBS swipe fully covers output before reveal");
  const colors = [];
  for (let i = 0; i < frames.length; i += 1728) {
    const pixel = frames.subarray(i + 1356, i + 1359);
    if (pixel[0] > 100 || pixel[2] > 70) continue; // Opaque OBS transition wash.
    const color =
      pixel[1] > 150 ? "recorded" : pixel[2] > 20 ? "live" : "startup";
    if (colors.at(-1) !== color) colors.push(color);
  }
  assert.deepEqual(
    colors,
    ["startup", "recorded", "live", "recorded", "live"],
    "replay restores captured video, then current live; next buffer contains only live",
  );
  await writeFile(
    join(evidence, "replay-verified.json"),
    JSON.stringify({
      duration,
      decodedBytes: frames.length,
      automaticReturn: true,
      manualReturn: true,
    }),
  );
  console.log(
    "Replay capture, playback, automatic/manual return and recording decode passed:",
    evidence,
  );
} finally {
  child.stdin.end();
  if (child.exitCode === null) child.kill();
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
}
