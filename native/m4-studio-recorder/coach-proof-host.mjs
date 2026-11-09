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

export async function startNativeCoachProof(
  inputHost,
  inputRuntime,
  ffmpeg,
  evidenceRoot,
) {
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
    res.end(`<!doctype html><style>body{margin:0;background:#00c040;color:white;font:64px system-ui;text-align:center}img{height:240px;object-fit:contain}#marker{position:fixed;bottom:0;right:0;width:12px;height:12px}</style><img src="/logo"><h1 id="label">LOCAL COACH PROOF</h1><div id="marker"></div><script>
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
      "--coach-control",
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
      tag === "CCS1"
        ? "CCT1"
        : tag === "RFS1"
          ? "RFP1"
          : tag === "RPS1"
            ? "RPT1"
            : "RFA1",
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

  const url = Buffer.from("http://127.0.0.1:" + server.address().port + "/");
  const startup = Buffer.alloc(4 + url.length);
  startup.writeUInt32LE(url.length);
  url.copy(startup, 4);
  child.stdin.write(startup);
  try {
    assert.equal((await exact(30)).subarray(22, 26).toString(), "COV1");
  } catch (error) {
    child.kill();
    server.close();
    throw error;
  }
  let busy = false;
  return {
    async capture() {
      if (busy) throw Error("Capture in progress");
      busy = true;
      try {
        const ready = await command("CCS1", 24);
        assert(
          [1, 3].includes(ready.readUInt32LE(8)),
          "Buffer warming or unavailable",
        );
        const capturedAt = new Date().toISOString();
        await command("CCC1");
        let status;
        for (let i = 0; i < 60; i++) {
          status = await command("CCS1", 24);
          if (status.readUInt32LE(8) === 3) break;
          assert.notEqual(status.readUInt32LE(8), 7);
          await delay(250);
        }
        assert.equal(status.readUInt32LE(8), 3);
        const source = join(
          evidence,
          "curlstreamer-m4-cef-" + "f".repeat(32),
          "coach.mp4",
        );
        const video = join(evidence, randomUUID() + ".mp4");
        // Immutable phone snapshot: final two minutes, no audio, fast-start MP4.
        await decode([
          "-sseof",
          "-120",
          "-i",
          source,
          "-map",
          "0:v:0",
          "-an",
          "-c:v",
          "copy",
          "-t",
          "120",
          "-movflags",
          "+faststart",
          video,
        ]);
        const probe = spawn(
          join(
            dirname(ffmpeg),
            "ffmpeg-8.0.1-essentials_build/bin/ffprobe.exe",
          ),
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "csv=p=0",
            video,
          ],
          { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
        );
        let duration = "";
        probe.stdout.on("data", (b) => (duration += b));
        assert.equal(
          await new Promise((r, j) => {
            probe.once("error", j);
            probe.once("exit", r);
          }),
          0,
        );
        return { video, duration: Number(duration), capturedAt };
      } finally {
        busy = false;
      }
    },
    close() {
      child.stdin.end();
      if (child.exitCode === null) child.kill();
      server.closeAllConnections();
      server.close();
    },
    evidence,
  };
}
