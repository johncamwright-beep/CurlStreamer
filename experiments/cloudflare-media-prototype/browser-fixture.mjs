// Loopback-only fake control API. No Modal, provider, media, or outbound requests.
import http from "node:http";
import fs from "node:fs";
const root = new URL("./", import.meta.url);
const port = Number(process.argv[2] || 3310);
let instance = 1,
  lost = false,
  started = false,
  ended = false,
  recovered = false,
  expired = false;
const expires = Math.floor(Date.now() / 1000) + 600;
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const send = (value, status = 200) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(value));
  };
  if (url.pathname === "/") {
    const html = fs
      .readFileSync(new URL("index.html", root), "utf8")
      .replace(
        "<main>",
        `<main><section><strong>OFFLINE FIXTURE — no camera, provider or GPU requests</strong><div class="buttons"><button onclick="fetch('/fixture/running',{method:'POST'})">Replace server (running)</button><button onclick="fetch('/fixture/idle',{method:'POST'})">Replace server (idle)</button><button onclick="fetch('/fixture/expired',{method:'POST'})">Expire link</button></div></section>`,
      );
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }
  if (url.pathname === "/assets/hls.min.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end("");
    return;
  }
  const asset = url.pathname.replace("/assets/", "");
  if (["client.js", "camera-session.js", "style.css"].includes(asset)) {
    res.writeHead(200, {
      "Content-Type": asset.endsWith("css") ? "text/css" : "text/javascript",
    });
    res.end(fs.readFileSync(new URL(asset, root)));
    return;
  }
  if (url.pathname.startsWith("/fixture/") && req.method === "POST") {
    instance++;
    lost = true;
    ended = false;
    started = url.pathname.endsWith("running");
    expired = url.pathname.endsWith("expired");
    send({ fixture: true });
    return;
  }
  if (expired) {
    send({ detail: "Private link expired. Request a fresh link." }, 410);
    return;
  }
  if (url.pathname === "/auth" || url.pathname === "/resume-control") {
    recovered = url.pathname === "/resume-control";
    lost = false;
    send({
      role: "control",
      pageAccess: "offline-page",
      recoveryTicket: "offline-recovery-ticket",
      canStart: !recovered,
      expiresAt: expires,
      instance: String(instance),
    });
    return;
  }
  if (url.pathname === "/status") {
    if (lost) {
      send({ detail: "Open your private test link to connect." }, 401);
      return;
    }
    send({
      role: "control",
      canStart: !recovered,
      instance: String(instance),
      expiresAt: expires,
      started,
      ended,
      remaining: started ? 321 : 600,
      preview: false,
      generation: 0,
      cameras: {},
      encodedFrames: 0,
      encoderFps: 0,
      message: started
        ? "An existing fake run is active."
        : "No active test. Recovered control cannot start one.",
    });
    return;
  }
  send({ detail: "Offline fixture: mutation disabled" }, 403);
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Offline fixture: http://127.0.0.1:${port}/#offline-control — Ctrl+C stops it.`,
  ),
);
