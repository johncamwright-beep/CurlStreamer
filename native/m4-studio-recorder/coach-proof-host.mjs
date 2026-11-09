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
    res.end(`<!doctype html><style>body{margin:0;background:#081623;color:white;font:60px system-ui;text-align:center}#clock{font:120px monospace}#stone{position:absolute;top:60%;width:150px;height:150px;border-radius:50%;background:#ef4848;border:12px solid white}small{font-size:32px}</style><h1>LOCAL COACH PROOF</h1><div id="clock"></div><small>Simulated motion — not a camera feed</small><div id="stone"></div><script>
  const started=performance.now();
  function frame(){const seconds=(performance.now()-started)/1000;document.getElementById('clock').textContent=seconds.toFixed(1)+' s';document.getElementById('stone').style.left=(10+65*(.5+.5*Math.sin(seconds/4)))+'%';requestAnimationFrame(frame)}frame();
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
