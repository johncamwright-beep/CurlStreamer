// Isolated synthetic proof. Never supply real provider credentials to this script.
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
const [host, plugin, runtime, ffmpeg, evidence] = process.argv.slice(2);
if (
  ![host, plugin, runtime, ffmpeg, evidence].every(
    (value) => value && path.isAbsolute(value),
  )
)
  throw new Error("Five absolute tooling paths required");
// Refuse to share an existing listener; receiver binds loopback only.
await new Promise((resolve, reject) => {
  const check = net.createServer();
  check.once("error", reject);
  check.listen(19359, "127.0.0.1", () => check.close(resolve));
});
const results = [];
async function boundedExit(child, timeoutMs) {
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });
  } finally {
    clearTimeout(timer);
  }
}
for (const mode of ["stop", "expiry"]) {
  const cwd = path.join(evidence, mode);
  await mkdir(cwd, { recursive: true });
  const receiver = spawn(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "fatal",
      "-y",
      "-listen",
      "1",
      "-timeout",
      "20",
      "-i",
      "rtmp://127.0.0.1:19359/live2/m4-canary-loopback",
      "-c",
      "copy",
      "received.flv",
    ],
    { cwd, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] },
  );
  receiver.stderr.resume();
  let receiverFailed = false;
  const receiverExit = new Promise((resolve) => {
    receiver.once("exit", resolve);
    receiver.once("error", () => {
      receiverFailed = true;
      resolve(null);
    });
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (receiverFailed || receiver.exitCode !== null)
      throw new Error("Loopback receiver could not start");
    const child = spawn(host, [plugin, runtime, mode], {
      cwd,
      windowsHide: true,
      env: { ...process.env, PATH: `${runtime};${process.env.PATH || ""}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let report = "";
    child.stdout.on("data", (chunk) => {
      report += chunk;
    });
    child.stderr.resume();
    const code = await boundedExit(child, 25000);
    await writeFile(path.join(cwd, "host-result.txt"), report);
    if (code !== 0)
      throw new Error(`Native ${mode} proof failed; inspect isolated evidence`);
    const decode = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "independent.mkv",
        "-f",
        "null",
        "-",
      ],
      { cwd, windowsHide: true, stdio: "ignore" },
    );
    const decoded = await boundedExit(decode, 10000);
    if (decoded !== 0) throw new Error("Independent MKV did not decode");
    results.push({ mode, nativePassed: true, independentMkvDecoded: true });
  } finally {
    receiver.kill();
    await receiverExit;
  }
}
await writeFile(
  path.join(evidence, "result.json"),
  JSON.stringify({ transport: "loopback RTMP; no TLS", results }, null, 2),
);
console.log(JSON.stringify(results));
