import { createServer } from "node:http";
import {
  mkdir,
  mkdtemp,
  stat,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { strict as assert } from "node:assert";
const [host, runtime, ffmpeg, evidence] = process.argv.slice(2);
assert(host && runtime && ffmpeg && evidence);
await mkdir(evidence, { recursive: true });
const directory = await mkdtemp(join(evidence, "browser-"));
const recording = join(directory, "program.mkv");
const cache = join(directory, "isolated-cache");
let hits = 0;
const server = createServer((req, res) => {
  if (req.url !== "/") {
    res.writeHead(404).end();
    return;
  }
  hits++;
  res.writeHead(200, {
    "Content-Type": "text/html",
    "Cache-Control": "no-store",
  });
  res.end(
    '<!doctype html><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{display:grid;grid-template:1fr 1fr/1fr 1fr}div:nth-child(1){background:#f00}div:nth-child(2){background:#0f0}div:nth-child(3){background:#00f}div:nth-child(4){background:#fff}</style><div style="position:absolute;left:0;top:0;width:50%;height:50%;background:red!important"></div><div style="position:absolute;right:0;top:0;width:50%;height:50%;background:lime!important"></div><div style="position:absolute;left:0;bottom:0;width:50%;height:50%;background:blue!important"></div><div style="position:absolute;right:0;bottom:0;width:50%;height:50%;background:white!important"></div>',
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
try {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(host, [runtime, recording, cache, url], {
      windowsHide: true,
      env: { ...process.env, PATH: `${runtime};${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Native browser validation deadline exceeded"));
    }, 20000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, output });
    });
  });

  assert.equal(result.code, 0, result.output);
  assert(hits > 0, "Browser must fetch the public loopback fixture");
  assert((await stat(join(cache, "obs-browser"))).isDirectory());
  const preferences = JSON.parse(
    await readFile(join(cache, "obs-browser", "UserPrefs.json"), "utf8"),
  );
  assert.deepEqual(
    preferences.webrtc?.local_ips_allowed_urls,
    [new URL(url).origin],
    "CEF address allowance must contain only the exact renderer origin",
  );
  const frame = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-v",
      "error",
      "-xerror",
      "-ss",
      "2",
      "-i",
      recording,
      "-frames:v",
      "1",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(frame.status, 0, String(frame.stderr));
  assert.equal(frame.stdout.length, 1920 * 1080 * 3);
  const pixel = (x, y) => [
    ...frame.stdout.subarray((y * 1920 + x) * 3, (y * 1920 + x) * 3 + 3),
  ];
  const colors = [
    pixel(480, 270),
    pixel(1440, 270),
    pixel(480, 810),
    pixel(1440, 810),
  ];
  colors.forEach((rgb, index) =>
    rgb.forEach((value, channel) =>
      assert(
        index === 3 || index === channel ? value > 180 : value < 65,
        `quadrant ${index}, channel ${channel}: ${value}`,
      ),
    ),
  );
  const decode = spawnSync(
    ffmpeg,
    [
      "-hide_banner",
      "-v",
      "error",
      "-xerror",
      "-i",
      recording,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-f",
      "null",
      "-",
    ],
    { windowsHide: true, stdio: ["ignore", "ignore", "pipe"], timeout: 15000 },
  );
  assert.equal(decode.status, 0, String(decode.stderr));
  await writeFile(
    join(directory, "result.json"),
    JSON.stringify(
      {
        kind: "public-loopback-color-proof",
        width: 1920,
        height: 1080,
        colors,
        cacheEntries: await readdir(join(cache, "obs-browser")),
        decoded: true,
      },
      null,
      2,
    ),
  );
  process.stdout.write(
    "PASS: public browser quadrants recorded and decoded; fresh isolated cache used\n",
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
