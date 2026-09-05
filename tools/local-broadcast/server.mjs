import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.LOCAL_LAB_PORT || 4319);
const out = resolve(process.env.LOCAL_LAB_OUTPUT || ".local-broadcast-private");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const encoder = process.env.LOCAL_LAB_ENCODER || "libx264";
if (
  !["libx264", "h264_nvenc", "h264_videotoolbox", "h264_qsv"].includes(encoder)
)
  throw Error("Unsupported encoder");
await mkdir(out, { recursive: true });
const roles = ["host", "camera1", "camera2"];
const keys = Object.fromEntries(
  roles.map((role) => [role, randomBytes(24).toString("hex")]),
);
const expires = Date.now() + 2 * 3600_000;
const queues = Object.fromEntries(roles.map((role) => [role, []]));
const seen = Object.fromEntries(roles.map((role) => [role, 0]));
let messageId = 0,
  processHandle = null,
  state = "idle",
  error = null;
let bytes = 0,
  nextChunk = 0,
  started = 0,
  lastChunk = 0,
  outputFile = null;
let completion = Promise.resolve(),
  closing = false;
const destination = process.env.LOCAL_LAB_YOUTUBE_URL;
if (
  destination &&
  !/^rtmps:\/\/[ab]\.rtmps\.youtube\.com(?::443)?\/live2\/[A-Za-z0-9_-]{8,200}$/.test(
    destination,
  )
)
  throw Error("Invalid YouTube destination");

await writeFile(
  join(out, "access.private.json"),
  JSON.stringify({ port, expires, keys }),
  { mode: 0o600 },
);
await writeFile(
  join(out, "open-host.url"),
  `[InternetShortcut]\nURL=http://localhost:${port}/#host:${keys.host}\n`,
  { mode: 0o600 },
);
function roleOf(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer /, "");
  return roles.find(
    (role) =>
      token.length === keys[role].length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(keys[role])),
  );
}
function localHost(req) {
  return (
    ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
      req.socket.remoteAddress,
    ) &&
    [`localhost:${port}`, `127.0.0.1:${port}`].includes(req.headers.host) &&
    !req.headers["x-forwarded-host"] &&
    !req.headers["cf-connecting-ip"]
  );
}
function send(res, code, value) {
  res.writeHead(code, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(value));
}
async function body(req, max = 128 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw Error("Request too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function signal(from, to, data) {
  queues[to].push({ id: ++messageId, from, data });
  if (queues[to].length > 150) queues[to].shift();
}
function stop(reason = null) {
  if (!processHandle || closing) return completion;
  closing = true;
  state = "stopping";
  error = reason;
  processHandle.stdin.end();
  const p = processHandle;
  const timer = setTimeout(() => p.kill(), 5000);
  timer.unref();
  return completion.finally(() => clearTimeout(timer));
}
function endCameras() {
  for (const role of roles.slice(1)) signal("host", role, { type: "stop" });
}
function start(hasAudio, youtube) {
  if (processHandle) throw Error("An output is already running");
  if (youtube && !destination) throw Error("YouTube is not configured");
  outputFile = `program-${Date.now()}.mp4`;
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-fflags",
    "+genpts",
    "-i",
    "pipe:0",
  ];
  if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
  args.push(
    "-map",
    "0:v:0",
    "-map",
    hasAudio ? "0:a:0" : "1:a:0",
    "-c:v",
    encoder,
  );
  if (encoder === "libx264")
    args.push("-preset", "veryfast", "-tune", "zerolatency");
  if (encoder === "h264_nvenc") args.push("-preset", "p4", "-tune", "ll");
  args.push(
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    "6M",
    "-maxrate",
    "6M",
    "-bufsize",
    "12M",
    "-g",
    "120",
    "-bf",
    "0",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-progress",
    join(out, "progress.txt"),
  );
  if (youtube) args.push("-rw_timeout", "15000000", "-f", "flv", destination);
  else args.push("-movflags", "+faststart", join(out, outputFile));
  bytes = 0;
  nextChunk = 0;
  started = lastChunk = Date.now();
  closing = false;
  error = null;
  state = "receiving";
  const p = spawn(ffmpeg, args, {
    windowsHide: true,
    stdio: ["pipe", "ignore", "ignore"],
  });
  processHandle = p;
  p.stdin.on("error", () => {
    error = "Encoder input stopped";
  });
  completion = new Promise((done) => {
    p.once("error", () => {
      error = "Encoder could not start";
    });
    p.once("close", (code) => {
      processHandle = null;
      state = code === 0 && !error ? "stopped" : "failed";
      if (code !== 0 && !error) error = "Encoder stopped unexpectedly";
      done();
    });
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("x-content-type-options", "nosniff");
    res.setHeader(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    if (req.method === "GET" && ["/", "/app.js", "/style.css"].includes(path)) {
      res.writeHead(200, {
        "content-type":
          path === "/"
            ? "text/html"
            : path.endsWith("js")
              ? "text/javascript"
              : "text/css",
        "cache-control": "no-store",
      });
      return res.end(
        await readFile(
          join(folder, path === "/" ? "index.html" : path.slice(1)),
        ),
      );
    }
    const role = roleOf(req);
    if (!role || Date.now() > expires)
      return send(res, 401, { error: "Test access expired or invalid" });
    if (role === "host" && !localHost(req))
      return send(res, 403, { error: "Open the host on the scoring computer" });
    if (
      req.method === "POST" &&
      req.headers.origin &&
      req.headers.origin !== `http://${req.headers.host}` &&
      req.headers.origin !== `https://${req.headers.host}`
    )
      return send(res, 403, { error: "Origin mismatch" });
    seen[role] = Date.now();
    if (path === "/poll" && req.method === "GET") {
      const messages = queues[role].splice(0);
      return send(res, 200, {
        messages,
        hostAvailable: Date.now() - seen.host < 10_000,
        state,
        error,
        bytes,
        elapsed: started ? Math.round((Date.now() - started) / 1000) : 0,
        outputFile,
        youtubeConfigured: Boolean(destination),
        encoder,
      });
    }
    if (path === "/signal" && req.method === "POST") {
      const { to, data } = JSON.parse(await body(req));
      if (
        !roles.includes(to) ||
        to === role ||
        (role !== "host" && to !== "host") ||
        !data ||
        !(
          role === "host"
            ? ["offer", "ice", "stop"]
            : ["hello", "answer", "ice", "bye"]
        ).includes(data.type)
      )
        return send(res, 400, { error: "Invalid signal" });
      signal(role, to, data);
      return send(res, 200, { ok: true });
    }
    if (role !== "host") return send(res, 403, { error: "Host only" });
    if (path === "/start" && req.method === "POST") {
      const options = JSON.parse(await body(req));
      start(options.audio === true, options.youtube === true);
      return send(res, 200, { state });
    }
    if (path === "/chunk" && req.method === "POST") {
      if (!processHandle || closing)
        return send(res, 409, { error: "No output running" });
      if (Number(req.headers["x-chunk-sequence"]) !== nextChunk)
        return send(res, 409, { error: "Recording chunk out of order" });
      const data = await body(req, 4 * 1024 * 1024);
      const input = processHandle.stdin;
      await new Promise((done, reject) =>
        input.write(data, (err) => (err ? reject(err) : done())),
      );
      nextChunk++;
      bytes += data.length;
      lastChunk = Date.now();
      return send(res, 200, { ok: true });
    }
    if (path === "/stop" && req.method === "POST") {
      endCameras();
      await stop();
      return send(res, 200, { state, error, outputFile });
    }
    return send(res, 404, { error: "Not found" });
  } catch {
    if (!res.headersSent)
      send(res, 400, { error: "Request could not be completed" });
    else res.end();
  }
});
const watchdog = setInterval(() => {
  if (
    processHandle &&
    !closing &&
    (Date.now() - lastChunk > 15_000 ||
      Date.now() - started > 30 * 60_000 ||
      Date.now() > expires)
  ) {
    endCameras();
    void stop("Test stopped by time or connection limit");
  }
}, 1000);
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Local broadcast lab ready on port ${port}. Private access file saved. No cameras or outputs started.`,
  ),
);
async function shutdown() {
  clearInterval(watchdog);
  endCameras();
  await stop();
  server.close();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
