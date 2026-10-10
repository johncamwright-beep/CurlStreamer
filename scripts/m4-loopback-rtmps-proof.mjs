// Isolated synthetic proof. Never supply real provider credentials to this script.
import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import tls from "node:tls";
const [host, plugin, runtime, ffmpeg, evidence, outputs, certificates] =
  process.argv.slice(2);
if (
  ![host, plugin, runtime, ffmpeg, evidence, outputs, certificates].every(
    (value) => value && path.isAbsolute(value),
  )
)
  throw new Error("Seven absolute tooling paths required");
// Refuse to share an existing listener; receiver binds loopback only.
await new Promise((resolve, reject) => {
  const check = net.createServer();
  check.once("error", reject);
  check.listen(19359, "127.0.0.1", () => check.close(resolve));
});
await mkdir(evidence, { recursive: true });
await rm(path.join(evidence, "result.json"), { force: true });
const results = [];
const sockets = new Set();
let handshakes = 0;
let tlsRejected = 0;
const proxy = tls.createServer(
  {
    key: await readFile(path.join(certificates, "localhost-key.pem")),
    cert: await readFile(path.join(certificates, "localhost.pem")),
    minVersion: "TLSv1.2",
  },
  (socket) => {
    handshakes++;
    const upstream = net.connect(19359, "127.0.0.1");
    sockets.add(socket);
    sockets.add(upstream);
    socket.on("error", () => upstream.destroy());
    upstream.on("error", () => socket.destroy());
    socket.on("close", () => {
      upstream.destroy();
      sockets.delete(socket);
    });
    upstream.on("close", () => {
      socket.destroy();
      sockets.delete(upstream);
    });
    socket.pipe(upstream);
    upstream.pipe(socket);
  },
);
proxy.on("tlsClientError", () => {
  tlsRejected++;
});
await new Promise((resolve, reject) => {
  proxy.once("error", reject);
  proxy.listen(19360, "127.0.0.1", resolve);
});
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
try {
  for (const mode of ["stop", "expiry", "wrong-host", "untrusted"]) {
    const rejected = mode === "wrong-host" || mode === "untrusted";
    const identity = rejected ? mode : "localhost";
    proxy.setSecureContext({
      key: await readFile(path.join(certificates, identity + "-key.pem")),
      cert: await readFile(path.join(certificates, identity + ".pem")),
      minVersion: "TLSv1.2",
    });
    const handshakesBefore = handshakes;
    const rejectedBefore = tlsRejected;
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
      const child = spawn(host, [plugin, runtime, mode, outputs], {
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
        throw new Error(
          `Native ${mode} proof failed; inspect isolated evidence`,
        );
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
      if (
        rejected
          ? handshakes !== handshakesBefore || tlsRejected <= rejectedBefore
          : handshakes <= handshakesBefore
      )
        throw new Error("TLS handshake outcome did not match certificate case");
      if (!rejected) {
        await Promise.race([
          receiverExit,
          new Promise((resolve) => setTimeout(resolve, 1000)),
        ]);
        const receivedDecode = spawn(
          ffmpeg,
          [
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            "received.flv",
            "-f",
            "null",
            "-",
          ],
          {
            cwd,
            windowsHide: true,
            stdio: "ignore",
          },
        );
        if ((await boundedExit(receivedDecode, 10000)) !== 0)
          throw new Error("Received RTMPS media did not decode");
      }
      results.push({
        mode,
        nativePassed: true,
        independentMkvDecoded: true,
        tlsHandshakeAccepted: !rejected,
        receivedMediaDecoded: !rejected,
      });
    } finally {
      receiver.kill();
      await receiverExit;
    }
  }
  await writeFile(
    path.join(evidence, "result.json"),
    JSON.stringify(
      {
        transport:
          "loopback RTMPS; isolated CA; hostname verification required",
        results,
      },
      null,
      2,
    ),
  );
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => proxy.close(resolve));
}
console.log(JSON.stringify(results));
