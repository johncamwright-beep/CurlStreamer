// Production plugin only: exercises the real recorder/bootstrap without a
// public target or test-only ARM export. All keys below are synthetic canaries.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { connect } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const [host, runtime, plugin, ffmpeg, evidenceRoot] = process.argv.slice(2);
assert.ok(host && runtime && plugin && ffmpeg && evidenceRoot);
const evidence = join(evidenceRoot, randomUUID());
await mkdir(evidence, { recursive: true });
const canary = "m4-canary-recorder-default-deny";
const env = { SystemRoot: process.env.SystemRoot, PATH: runtime };
const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(
    '<html><body style="margin:0;background:rgb(255,0,0)"></body></html>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const programUrl = `http://127.0.0.1:${server.address().port}/`;

function deadline(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function run(scenario) {
  const destination = join(evidence, `${scenario}.mkv`);
  const browser = scenario === "default" || scenario === "job-kill";
  const args = [
    "--parent-pid",
    String(process.pid),
    "--runtime",
    runtime,
    "--recording",
    destination,
  ];
  if (browser)
    args.push(
      "--program-cache",
      join(evidence, `cache-${scenario}`),
      "--webrtc-ip-handling-policy=default",
      "--disable-features=WebRtcHideLocalIpsWithMdns",
    );
  args.push("--stream-plugin", plugin);
  const child = spawn(host, args, {
    env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let socket,
    leaked = false;
  child.stderr.on("data", (data) => {
    if (data.includes(canary)) leaked = true;
  });
  const closed = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  if (browser) {
    const url = Buffer.from(programUrl);
    const frame = Buffer.alloc(4 + url.length);
    frame.writeUInt32LE(url.length);
    url.copy(frame, 4);
    child.stdin.write(frame);
  }
  try {
    const chunks = [];
    child.stdout.on("data", (data) => chunks.push(data));
    await deadline(
      new Promise((resolve) => child.stdout.once("end", resolve)),
      15000,
      "readiness timeout",
    );
    const bytes = Buffer.concat(chunks);
    assert.equal(bytes.length, 302, "exact READY and versioned bootstrap");
    assert.equal(bytes.subarray(0, 6).toString(), "READY\n");
    if (browser) {
      assert.deepEqual(
        JSON.parse(
          await readFile(
            join(evidence, `cache-${scenario}`, ".m4-owner.json"),
            "utf8",
          ),
        ),
        { schema: "m4-cef-owner-v1", pid: child.pid, jobBound: true },
      );
    }
    const frame = bytes.subarray(6);
    assert.equal(frame.readUInt32LE(0), 0x4d344253);
    assert.equal(frame.readUInt16LE(4), 1);
    assert.equal(frame.readUInt16LE(6), 0);
    const pipe = frame.subarray(8, 264).toString("utf16le").split("\0")[0];
    const token = Buffer.from(frame.subarray(264));
    bytes.fill(0);
    socket = connect(pipe);
    socket.on("error", () => {});
    await deadline(
      new Promise((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      }),
      2000,
      "connect timeout",
    );
    if (scenario === "job-kill") {
      // Query only process ancestry/IDs, never command lines or environment.
      const ps = spawn(
        join(
          process.env.SystemRoot,
          "System32",
          "WindowsPowerShell",
          "v1.0",
          "powershell.exe",
        ),
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$rows = Get-CimInstance Win32_Process; $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add(${child.pid}); do { $added = 0; foreach ($row in $rows) { if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) { $added++ } } } while ($added -gt 0); @($rows | Where-Object { $ids.Contains([int]$_.ProcessId) -and $_.ProcessId -ne ${child.pid} } | Select-Object ProcessId,Name) | ConvertTo-Json -Compress`,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      const result = [];
      ps.stdout.on("data", (data) => result.push(data));
      assert.equal(
        await deadline(
          new Promise((resolve, reject) => {
            ps.once("error", reject);
            ps.once("exit", resolve);
          }),
          8000,
          "process ancestry timeout",
        ),
        0,
      );
      const raw = JSON.parse(Buffer.concat(result).toString());
      const descendants = Array.isArray(raw) ? raw : [raw];
      assert.ok(
        descendants.some((row) => row.Name === "obs-browser-page.exe"),
        "real CEF descendant observed",
      );
      assert.ok(
        descendants.some((row) => row.Name === "obs-ffmpeg-mux.exe"),
        "real mux descendant observed",
      );
      token.fill(0);
      child.kill();
      assert.notEqual(
        await deadline(closed, 5000, "forced recorder exit timeout"),
        0,
        "forced exit cannot claim finalization",
      );
      const alive = (pid) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (error) {
          if (error.code === "ESRCH") return false;
          throw error;
        }
      };
      for (
        let attempts = 0;
        attempts < 40 && descendants.some((row) => alive(row.ProcessId));
        ++attempts
      )
        await delay(50);
      assert.ok(
        descendants.every((row) => !alive(row.ProcessId)),
        "job killed every observed CEF/mux descendant",
      );
      console.log(
        "PASS job-kill: forced recorder exit killed observed CEF/mux descendants; no finalization claim",
      );
      return;
    }
    if (scenario === "idle-stop") await delay(32000);
    const before = (await stat(destination)).size;
    if (scenario === "disconnect") socket.destroy();
    else {
      const arm = scenario === "default";
      const header = Buffer.alloc(52 + (arm ? 516 : 0));
      header.writeUInt32LE(0x4d344950, 0);
      header.writeUInt32LE(1, 4);
      header.writeUInt32LE(arm ? 1 : 3, 8);
      header.writeUInt32LE(arm ? 516 : 0, 12);
      header.writeUInt32LE(1, 16);
      token.copy(header, 20);
      if (arm) {
        header.writeUInt32LE(5000, 52);
        header.write("rtmps://synthetic.invalid/live2", 56);
        header.write(canary, 312);
      }
      if (scenario === "partial") {
        const ended = new Promise((resolve) => socket.once("end", resolve));
        socket.write(header.subarray(0, 1));
        await deadline(
          ended,
          3000,
          "partial frame must revoke within bounded transfer",
        );
      } else {
        const replyPromise = new Promise((resolve, reject) => {
          let reply = Buffer.alloc(0);
          socket.on("data", (data) => {
            reply = Buffer.concat([reply, data]);
            if (reply.length >= 16) resolve(reply);
          });
          socket.once("error", reject);
          socket.once("end", () => {
            if (reply.length < 16) reject(new Error("reply missing"));
          });
        });
        socket.write(header);
        const reply = await deadline(replyPromise, 3000, "reply timeout");
        assert.equal(
          reply.readUInt32LE(8),
          arm ? 1 : 0,
          "default ARM denied; STOP acknowledged",
        );
        assert.equal(reply.readUInt32LE(12), 2, "authority revoked");
      }
      header.fill(0);
    }
    token.fill(0);
    await delay(2400);
    assert.equal(
      child.exitCode,
      null,
      "stream terminal state preserves recording host",
    );
    assert.ok(
      (await stat(destination)).size > before,
      "MKV keeps growing after stream termination",
    );
    child.stdin.end();
    assert.equal(
      await deadline(closed, 12000, "finalization timeout"),
      0,
      "clean independent recording finalization",
    );
    assert.equal(leaked, false, "synthetic canary absent from stderr");
    const decode = spawn(
      ffmpeg,
      [
        "-v",
        "error",
        "-xerror",
        "-i",
        destination,
        "-map",
        "0:v:0",
        "-map",
        "0:a:0",
        "-f",
        "null",
        "-",
      ],
      { windowsHide: true, stdio: "ignore" },
    );
    assert.equal(
      await deadline(
        new Promise((resolve, reject) => {
          decode.once("error", reject);
          decode.once("exit", resolve);
        }),
        15000,
        "decode timeout",
      ),
      0,
    );
    console.log(
      `PASS ${scenario}: authenticated production topology; MKV continued and decoded`,
    );
  } finally {
    socket?.destroy();
    if (child.exitCode === null) {
      child.stdin.end();
      child.kill();
    }
  }
}
try {
  const selected = process.argv.slice(7);
  for (const scenario of selected.length
    ? selected
    : ["default", "disconnect", "partial", "idle-stop", "job-kill"])
    await run(scenario);
} finally {
  await new Promise((resolve) => server.close(resolve));
}
