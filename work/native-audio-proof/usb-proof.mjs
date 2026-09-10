import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";

const [recorder, runtime, ffmpeg, outputRoot] = process.argv.slice(2);
assert.ok(recorder && runtime && ffmpeg && outputRoot);
const root = resolve(process.cwd());
await mkdir(outputRoot, { recursive: true });
const directory = await mkdtemp(join(outputRoot, "usb-"));
const recording = join(directory, "program-usb-440hz.mkv");
const cache = join(directory, "cache");
const entry = join(directory, "program-usb-fixture.tsx");
const bundle = join(directory, "program-usb-fixture.js");

await writeFile(
  entry,
  `import React from "react";
import { createRoot } from "react-dom/client";
import { ProgramUsbAudio } from ${JSON.stringify(join(root, "src/components/ProgramUsbAudio.tsx").replaceAll("\\", "/"))};
createRoot(document.getElementById("root")).render(<ProgramUsbAudio />);`,
);
const esbuild = spawnSync(
  process.execPath,
  [
    join(root, "node_modules/esbuild/bin/esbuild"),
    entry,
    "--bundle",
    "--platform=browser",
    "--format=iife",
    "--target=chrome120",
    "--jsx=automatic",
    `--outfile=${bundle}`,
  ],
  { cwd: root, windowsHide: true, encoding: "utf8" },
);
assert.equal(esbuild.status, 0, esbuild.stderr);
const fixture = await readFile(bundle);
const page = `<!doctype html><meta charset="utf-8"><div id="root"></div><script src="/fixture.js"></script>`;
let firstRequestAt = 0;
let sentSamples = 0;
const chunkSamples = 2_400;
const tone = () => {
  const pcm = Buffer.alloc(chunkSamples * Float32Array.BYTES_PER_ELEMENT);
  for (let sample = 0; sample < chunkSamples; sample++)
    pcm.writeFloatLE(
      Math.sin((2 * Math.PI * 440 * (sentSamples + sample)) / 48_000) * 0.5,
      sample * 4,
    );
  sentSamples += chunkSamples;
  return pcm;
};
const server = createServer((request, response) => {
  if (request.url === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page);
    return;
  }
  if (request.url === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
    response.end(fixture);
    return;
  }
  if (request.url === "/usb-audio") {
    firstRequestAt ||= Date.now();
    const active = Date.now() - firstRequestAt < 3_000;
    response.setHeader("cache-control", "no-store");
    response.setHeader("x-m4-usb-audio-generation", active ? "1" : "2");
    if (!active) return response.writeHead(204).end();
    const pcm = tone();
    response.writeHead(200, { "content-type": "application/octet-stream", "content-length": pcm.length });
    response.end(pcm, () => pcm.fill(0));
    return;
  }
  response.writeHead(404).end();
});
await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const url = `http://127.0.0.1:${server.address().port}/`;
try {
  const result = await new Promise((resolveChild, rejectChild) => {
    const child = spawn(
      recorder,
      [
        "--parent-pid", String(process.pid), "--runtime", runtime,
        "--recording", recording, "--program-cache", cache,
        "--webrtc-ip-handling-policy=default", "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
      { cwd: dirname(recorder), windowsHide: true, shell: false, stdio: ["pipe", "pipe", "pipe"], env: { SystemRoot: process.env.SystemRoot, PATH: `${runtime};${join(process.env.SystemRoot, "System32")}`, NODE_ENV: "production" } },
    );
    const stderr = [];
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    const deadline = setTimeout(() => { child.kill(); rejectChild(new Error("Recorder readiness deadline exceeded")); }, 15_000);
    child.stdout.once("data", (chunk) => {
      if (String(chunk) !== "READY\n") { clearTimeout(deadline); child.kill(); rejectChild(new Error("Recorder did not report readiness")); return; }
      setTimeout(() => child.stdin.end(), 8_000);
    });
    child.once("error", rejectChild);
    child.once("exit", (code) => { clearTimeout(deadline); resolveChild({ code, stderr: Buffer.concat(stderr).toString("utf8") }); });
    const data = Buffer.from(url, "utf8");
    const frame = Buffer.alloc(4 + data.length);
    frame.writeUInt32LE(data.length); data.copy(frame, 4);
    child.stdin.write(frame, () => frame.fill(0));
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(firstRequestAt, "ProgramUsbAudio did not request USB PCM");
  const decoded = spawnSync(ffmpeg, ["-hide_banner", "-v", "error", "-xerror", "-i", recording, "-map", "0:a:0", "-ac", "1", "-f", "f32le", "-acodec", "pcm_f32le", "-"], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(decoded.status, 0, String(decoded.stderr));
  const samples = decoded.stdout.length / 4;
  let peak = 0, square = 0, lastAudible = -1;
  for (let offset = 0; offset < decoded.stdout.length; offset += 4) {
    const value = decoded.stdout.readFloatLE(offset);
    assert.ok(Number.isFinite(value), "AAC decode contains non-finite sample");
    peak = Math.max(peak, Math.abs(value)); square += value * value;
    if (Math.abs(value) > 0.01) lastAudible = offset / 4;
  }
  const tail = decoded.stdout.subarray(Math.max(0, (lastAudible + 1) * 4));
  let tailSquare = 0;
  for (let offset = 0; offset < tail.length; offset += 4) tailSquare += decoded.stdout.readFloatLE(offset + (lastAudible + 1) * 4) ** 2;
  const rms = Math.sqrt(square / samples);
  const tailRms = tail.length ? Math.sqrt(tailSquare / (tail.length / 4)) : Infinity;
  assert.ok(peak > 0.01 && rms > 0.003 && lastAudible > 48_000, "AAC output lacks USB tone");
  assert.ok(samples - lastAudible > 48_000 && tailRms < 0.003, "generation stop did not leave a silent tail");
  const evidence = { recording, samples, peak, rms, lastAudible, tailSamples: samples - lastAudible, tailRms, toneHz: 440, generationStop: 2 };
  await writeFile(join(directory, "result.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally {
  server.closeAllConnections();
  await new Promise((resolveServer) => server.close(resolveServer));
}
