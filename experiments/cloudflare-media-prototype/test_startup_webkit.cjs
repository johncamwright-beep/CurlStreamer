"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { test } = require("node:test");
const { devices, webkit } = require("playwright");

const root = __dirname;
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptOrder = [...index.matchAll(/<script defer src="([^"]+)"/g)].map(
  ([, source]) => source,
);

test("camera startup scripts execute before the optional observer player", () => {
  assert.deepEqual(scriptOrder, [
    "/assets/camera-session.js",
    "/assets/client.js",
  ]);
});

function fixture({ role, stallHls = false, preview = false }) {
  const requests = [];
  const pending = new Set();
  const server = http.createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(index);
      return;
    }
    if (request.method === "GET" && request.url === "/assets/style.css") {
      response.writeHead(200, { "content-type": "text/css" });
      response.end("");
      return;
    }
    if (
      request.method === "GET" &&
      ["/assets/camera-session.js", "/assets/client.js"].includes(request.url)
    ) {
      response.writeHead(200, { "content-type": "text/javascript" });
      response.end(
        fs.readFileSync(path.join(root, path.basename(request.url))),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/assets/hls.min.js") {
      if (stallHls) {
        pending.add(response);
        response.on("close", () => pending.delete(response));
      } else {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(`
          window.__observerPlayerLoaded = true;
          window.Hls = class {
            static isSupported() { return true; }
            static Events = { ERROR: "error", MANIFEST_PARSED: "manifest" };
            static ErrorTypes = { NETWORK_ERROR: "network" };
            on() {}
            loadSource(url) { fetch(url); }
            attachMedia() {}
            destroy() {}
          };
        `);
      }
      return;
    }
    if (request.method === "POST" && request.url === "/auth") {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          role,
          pageAccess: "fixture-page",
          canStart: true,
          expiresAt: Math.floor(Date.now() / 1000) + 600,
        }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/status") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          role,
          instance: "fixture-instance",
          ended: false,
          started: preview,
          remaining: 600,
          cameras: {},
          encodedFrames: 0,
          encoderFps: 0,
          message: "Ready",
          preview,
          generation: 1,
        }),
      );
      return;
    }
    if (request.method === "GET" && request.url === "/hls/program.m3u8") {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(404).end();
  });
  return {
    requests,
    async start() {
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      return `http://127.0.0.1:${server.address().port}/#fixture-token`;
    },
    async close() {
      for (const response of pending) response.destroy();
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function pageFor(server, { forceMse = false } = {}) {
  const browser = await webkit.launch({ headless: true });
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  if (forceMse)
    await page.addInitScript(() => {
      HTMLMediaElement.prototype.canPlayType = () => "";
    });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(await server.start(), { waitUntil: "commit" });
  return { browser, errors, page };
}

test("a stalled observer player cannot block Camera 1 authentication", async () => {
  const server = fixture({ role: "camera1", stallHls: true });
  const { browser, errors, page } = await pageFor(server);
  try {
    await page
      .getByRole("heading", { name: "Camera 1", exact: true })
      .waitFor({ timeout: 5000 });
    assert.equal(
      await page.getByRole("button", { name: "Connect camera" }).isVisible(),
      true,
    );
    assert.deepEqual(errors, []);
    assert.ok(server.requests.includes("POST /auth"));
    assert.ok(server.requests.includes("GET /status"));
    assert.equal(server.requests.includes("GET /assets/hls.min.js"), false);
    assert.equal(
      server.requests.some((request) =>
        /POST \/(start|camera-claim|camera-start|attach|receive)/.test(request),
      ),
      false,
    );
  } finally {
    await browser.close();
    await server.close();
  }
});

test("a non-native WebKit preview waits for the observer player", async () => {
  const server = fixture({ role: "control", preview: true });
  const { browser, errors, page } = await pageFor(server, { forceMse: true });
  try {
    await page
      .getByRole("heading", { name: "Test control", exact: true })
      .waitFor({ timeout: 5000 });
    await page.waitForFunction(() => window.__observerPlayerLoaded === true);
    await page.waitForFunction(
      () => document.querySelector("#previewState")?.dataset.mode === "mse",
    );
    assert.deepEqual(errors, []);
    assert.ok(server.requests.includes("GET /assets/hls.min.js"));
    assert.ok(server.requests.includes("GET /hls/program.m3u8"));
  } finally {
    await browser.close();
    await server.close();
  }
});
