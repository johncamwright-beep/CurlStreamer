import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import type { M4RendererHeartbeat } from "../src/lib/providers/m4-renderer-health-browser";
import type { M4CameraInputSnapshot } from "../src/lib/m4-camera-input";

type Role = "camera-home" | "camera-away";
type Observation = {
  action: string;
  cameraRole?: Role;
  frames?: number;
  verified?: boolean;
  sourceGeneration?: number;
};
const roles: Role[] = ["camera-home", "camera-away"];
const snapshot = (
  kind: "phone" | "tapo" | "rtsp",
  generation: number,
): M4CameraInputSnapshot => ({
  kind,
  connectionEnabled: kind !== "phone",
  generation,
  host: kind === "tapo" ? "192.168.1.20" : null,
  stream: kind === "tapo" ? "stream1" : null,
  rotation: 0,
  configured: true,
  phase: "streaming",
  errorCode: null,
});
const game = {
  id: "77777777-7777-4777-8777-777777777777",
  config: {
    eventName: "Local camera fixture",
    homeName: "Home",
    awayName: "Away",
    homeColor: "#ef4444",
    awayColor: "#3b82f6",
  },
  score: { hammer: "home", totals: { home: 0, away: 0 }, currentEnd: 1 },
  layout: "split",
  broadcast: "idle",
  audioMuted: true,
  cameraAudio: {
    "camera-home": { enabled: false },
    "camera-away": { enabled: false },
  },
  cameraFraming: { "camera-home": "contain", "camera-away": "contain" },
  sponsors: [
    {
      id: "fixture-sponsor",
      name: "Full-frame sponsor fixture",
      dataUrl: "/fixture-sponsor.svg",
      enabled: true,
      rotation: 0,
    },
  ],
  sponsorMode: {
    active: true,
    style: "fullscreen",
    intervalSeconds: 10,
    startedAt: null,
    rotationOffset: 0,
    paused: false,
  },
};
let renderer: string;
let css: string;
let jpeg: Buffer;

test.beforeAll(async () => {
  const bundle = await build({
    entryPoints: ["src/lib/providers/m4-program-renderer-browser.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "explicit-synthetic-phone-transport",
        setup(builder) {
          builder.onResolve({ filter: /^\.\/m4-program-camera$/ }, () => ({
            path: "phone",
            namespace: "fixture",
          }));
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            loader: "js",
            contents: `
            export async function connectM4ProgramCamera(options) {
              const state=window.__phoneFixture??={starts:{},stops:{}};
              state.starts[options.role]=(state.starts[options.role]??0)+1;
              const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
              const context=canvas.getContext('2d');context.fillStyle='#1768dd';context.fillRect(0,0,90,160);
              const stream=canvas.captureStream(20);options.onVideo(stream);
              let frames=0,stopped=false;
              const sample=()=>{if(!stopped)options.onMetrics({direct:true,framesDecoded:++frames,bytesReceived:frames*1000,connectionState:'connected',iceConnectionState:'connected'});};
              sample();const timer=setInterval(sample,100);
              return {stop(){if(stopped)return;stopped=true;clearInterval(timer);stream.getTracks().forEach(t=>t.stop());state.stops[options.role]=(state.stops[options.role]??0)+1;}};
            }
          `,
          }));
        },
      },
    ],
  });
  renderer = bundle.outputFiles[0].text;
  css = execFileSync(
    process.execPath,
    [
      resolve("node_modules/tailwindcss/lib/cli.js"),
      "-i",
      "src/app/globals.css",
      "--minify",
    ],
    { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  // Wide image with distinct left/right edges exposes accidental portrait cropping.
  jpeg = await sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#e52a24"/><rect width="48" height="180" fill="#145ee5"/><rect x="272" width="48" height="180" fill="#19be35"/></svg>',
    ),
  )
    .jpeg({ quality: 95 })
    .toBuffer();
});

async function install(
  page: Page,
  kinds: ["phone" | "tapo" | "rtsp", "phone" | "tapo" | "rtsp"],
) {
  const sources: Record<Role, M4CameraInputSnapshot> = {
    "camera-home": snapshot(kinds[0], 1),
    "camera-away": snapshot(kinds[1], 1),
  };
  const mode: Record<
    Role,
    "live" | "absent" | "old-generation" | "repeated" | "invalid"
  > = { "camera-home": "live", "camera-away": "live" };
  const frames: Record<Role, Buffer> = {
    "camera-home": jpeg,
    "camera-away": jpeg,
  };
  const counter: Record<Role, number> = { "camera-home": 0, "camera-away": 0 };
  const frameRequests: { role: Role; generation: number; after: number }[] = [];
  // Count live browser fetches, excluding requests synchronously cancelled by
  // a source change; an intercepted route can finish after its fetch aborts.
  await page.addInitScript(`
    const original=window.fetch.bind(window);
    const flights=window.__frameFlights={active:{'camera-home':0,'camera-away':0},max:{'camera-home':0,'camera-away':0}};
    window.fetch=(input,options)=>{
      const role=String(input).match(new RegExp('[/]ip-camera[/](camera-home|camera-away)[/]frame'))?.[1];
      if(!role)return original(input,options);
      flights.active[role]++;flights.max[role]=Math.max(flights.max[role],flights.active[role]);
      let settled=false;const done=()=>{if(settled)return;settled=true;flights.active[role]--;options?.signal?.removeEventListener('abort',done);};
      options?.signal?.addEventListener('abort',done,{once:true});
      return original(input,options).finally(done);
    };
  `);
  const maxActive = () =>
    page.evaluate(
      () =>
        (window as unknown as { __frameFlights: { max: Record<Role, number> } })
          .__frameFlights.max,
    );
  const heartbeats: M4RendererHeartbeat[] = [];
  const observations: Observation[] = [];
  const accepted: Observation[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/ip-camera-program-fixture")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>',
      });
    if (url.pathname === "/fixture.js")
      return route.fulfill({ contentType: "text/javascript", body: renderer });
    if (url.pathname === "/fixture.css")
      return route.fulfill({ contentType: "text/css", body: css });
    if (url.pathname === "/branding/curlstreamer-logo.png")
      return route.fulfill({
        contentType: "image/png",
        body: readFileSync(resolve("public/branding/curlstreamer-logo.png")),
      });
    if (url.pathname === "/fixture-sponsor.svg")
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="white"/><rect width="24" height="360" fill="#145ee5"/><rect x="616" width="24" height="360" fill="#19be35"/><text x="320" y="185" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#07111f">Sponsor fixture</text></svg>',
      });
    if (url.pathname === "/renderer-health") {
      heartbeats.push(route.request().postDataJSON() as M4RendererHeartbeat);
      return route.fulfill({ json: { ok: true } });
    }
    if (url.pathname === "/program") return route.fulfill({ json: { game } });
    if (url.pathname === "/camera-inputs")
      return route.fulfill({ json: { cameras: sources } });
    if (url.pathname === "/camera") {
      const value = route.request().postDataJSON() as Observation;
      observations.push(value);
      const current = value.cameraRole ? sources[value.cameraRole] : undefined;
      if (
        value.action === "observe" &&
        current &&
        value.sourceGeneration === current.generation &&
        value.verified
      )
        accepted.push(value);
      return route.fulfill({ json: { ok: true } });
    }
    const frameRole = url.pathname.match(
      /^\/ip-camera\/(camera-home|camera-away)\/frame$/,
    )?.[1] as Role | undefined;
    if (frameRole) {
      frameRequests.push({
        role: frameRole,
        generation: Number(url.searchParams.get("generation")),
        after: Number(url.searchParams.get("after")),
      });
      const source = { ...sources[frameRole] },
        behavior = mode[frameRole];
      try {
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (behavior === "absent") return await route.fulfill({ status: 204 });
        const currentCounter =
          behavior === "repeated" ? counter[frameRole] : ++counter[frameRole];
        const body =
          behavior === "invalid"
            ? Buffer.from("invalid JPEG fixture")
            : frames[frameRole];
        return await route.fulfill({
          contentType: "image/jpeg",
          headers: {
            "content-length": String(body.length),
            "x-m4-ip-camera-generation": String(
              source.generation - (behavior === "old-generation" ? 1 : 0),
            ),
            "x-m4-ip-camera-frame": String(currentCounter),
          },
          body,
        });
      } catch {
        /* A generation change can abort an already-intercepted fetch. */
      }
      return;
    }
    if (
      url.pathname === "/usb-audio" ||
      /^\/ip-camera\/.+\/audio$/.test(url.pathname)
    )
      return route.fulfill({ status: 204 });
    return route.fulfill({ status: 404, body: "Fixture asset unavailable" });
  });
  await page.goto("http://127.0.0.1:3000/ip-camera-program-fixture");
  await expect(page.getByTestId("broadcast-canvas")).toBeVisible({
    timeout: 10000,
  });
  const phones = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __phoneFixture?: {
              starts: Partial<Record<Role, number>>;
              stops: Partial<Record<Role, number>>;
            };
          }
        ).__phoneFixture ?? { starts: {}, stops: {} },
    );
  return {
    sources,
    frames,
    mode,
    observations,
    accepted,
    errors,
    maxActive,
    phones,
    heartbeats,
    frameRequests,
  };
}

const panel = (page: Page, role: Role) =>
  page.getByTestId(`camera-panel-${role}`);

async function verifySponsor(page: Page) {
  const sponsor = page.getByTestId("sponsor-sidebar");
  const art = sponsor.getByRole("img", { name: "Full-frame sponsor fixture" });
  await expect(art).toBeVisible();
  const geometry = await art.evaluate((image) => {
    const bounds = image.getBoundingClientRect();
    return {
      aspect: bounds.width / bounds.height,
      fit: getComputedStyle(image).objectFit,
    };
  });
  expect(geometry.aspect).toBeCloseTo(16 / 9, 1);
  expect(geometry.fit).toBe("contain");
  expect(
    await sponsor
      .locator("p")
      .evaluate(
        (label) =>
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
      ),
  ).toBe(true);
}

async function verifyFrame(page: Page, role: Role) {
  const image = panel(page, role).getByRole("img", { name: "IP camera" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLCanvasElement) => element.width))
    .toBe(320);
  const geometry = await image.evaluate((element) => {
    const rect = element.getBoundingClientRect(),
      container = element.parentElement!.getBoundingClientRect();
    return {
      fit: getComputedStyle(element).objectFit,
      width: rect.width,
      height: rect.height,
      bounded:
        rect.width <= container.width + 1 &&
        rect.height <= container.height + 1,
    };
  });
  expect(geometry.fit).toBe("contain");
  expect(geometry.bounded).toBe(true);
  expect(geometry.width / geometry.height).toBeCloseTo(16 / 9, 1);
  // Verify displayed pixels, including both edges, inside the actual program.
  const { data, info } = await sharp(await image.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixel = (fraction: number) => {
    const i =
      (Math.floor(info.height / 2) * info.width +
        Math.floor(info.width * fraction)) *
      info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  };
  const [left, middle, right] = [pixel(0.08), pixel(0.5), pixel(0.92)];
  expect(left[2]).toBeGreaterThan(left[0] + 70);
  expect(middle[0]).toBeGreaterThan(middle[1] + 70);
  expect(right[1]).toBeGreaterThan(right[0] + 70);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
}

test("program composes mixed phone and Tapo frames while replacing only the selected camera", async ({
  page,
}, testInfo) => {
  const fixture = await install(page, ["phone", "tapo"]);
  await verifyFrame(page, "camera-away");
  await expect
    .poll(async () => (await fixture.phones()).starts["camera-home"])
    .toBe(1);
  await expect
    .poll(
      () =>
        fixture.accepted.filter((v) => v.cameraRole === "camera-home").length,
    )
    .toBeGreaterThan(0);
  expect((await fixture.phones()).starts["camera-away"]).toBeUndefined();
  const phone = panel(page, "camera-home").getByLabel("Direct camera");
  await expect
    .poll(() => phone.evaluate((video: HTMLVideoElement) => video.videoWidth))
    .toBe(90);
  const programBounds = (await page
    .getByTestId("broadcast-canvas")
    .boundingBox())!;
  const phoneBounds = (await phone.boundingBox())!;
  expect(phoneBounds.y).toBeCloseTo(programBounds.y, 1);
  expect(phoneBounds.height).toBeCloseTo(programBounds.height, 1);
  const phonePixels = await sharp(await phone.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const middle =
    (Math.floor(phonePixels.info.height / 2) * phonePixels.info.width +
      Math.floor(phonePixels.info.width / 2)) *
    phonePixels.info.channels;
  expect(phonePixels.data[middle + 2]).toBeGreaterThan(
    phonePixels.data[middle] + 70,
  );
  const proof = testInfo.outputPath("mixed-phone-tapo-program.png");
  await verifySponsor(page);
  await page.getByTestId("broadcast-canvas").screenshot({ path: proof });
  await testInfo.attach("mixed-phone-tapo-program", {
    path: proof,
    contentType: "image/png",
  });
  fixture.sources["camera-away"] = snapshot("phone", 2);
  await expect
    .poll(async () => (await fixture.phones()).starts["camera-away"])
    .toBe(1);
  await expect(
    panel(page, "camera-away").getByRole("img", { name: "IP camera" }),
  ).toHaveCount(0);
  fixture.sources["camera-away"] = snapshot("tapo", 3);
  await verifyFrame(page, "camera-away");
  await expect
    .poll(async () => (await fixture.phones()).stops["camera-away"])
    .toBe(1);
  // Metadata and source changes in Camera 2 preserve Camera 1's live owner.
  const current = await fixture.phones();
  expect(current.starts["camera-home"]).toBe(1);
  expect(current.stops["camera-home"] ?? 0).toBe(0);
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test("portrait program feeds touch and use the complete canvas height", async ({
  page,
}, testInfo) => {
  const fixture = await install(page, ["phone", "phone"]);
  for (const role of roles)
    await expect
      .poll(() =>
        panel(page, role)
          .getByLabel("Direct camera")
          .evaluate((video: HTMLVideoElement) => video.videoWidth),
      )
      .toBe(90);
  const program = (await page.getByTestId("broadcast-canvas").boundingBox())!;
  const frames = await Promise.all(
    roles.map((role) => panel(page, role).boundingBox()),
  );
  for (const frame of frames) {
    expect(frame!.y).toBeCloseTo(program.y, 1);
    expect(frame!.height).toBeCloseTo(program.height, 1);
    expect(frame!.width / frame!.height).toBeCloseTo(9 / 16, 3);
  }
  expect(frames[0]!.x).toBeCloseTo(program.x, 1);
  expect(frames[0]!.x + frames[0]!.width).toBeCloseTo(frames[1]!.x, 1);
  const proof = testInfo.outputPath("portrait-pair-program.png");
  await verifySponsor(page);
  await page.getByTestId("broadcast-canvas").screenshot({ path: proof });
  await testInfo.attach("portrait-pair-program", {
    path: proof,
    contentType: "image/png",
  });
  expect(fixture.errors).toEqual([]);
});

test("program stacks legacy Tapo and generic RTSP frames with full image edges and one frame request per role", async ({
  page,
}, testInfo) => {
  const fixture = await install(page, ["tapo", "rtsp"]);
  for (const role of roles) await verifyFrame(page, role);
  for (const role of roles) {
    await expect
      .poll(() => fixture.accepted.filter((v) => v.cameraRole === role).length)
      .toBeGreaterThan(1);
    expect((await fixture.maxActive())[role]).toBe(1);
  }
  expect((await fixture.phones()).starts).toEqual({});
  const frames = await Promise.all(
    roles.map((role) => panel(page, role).boundingBox()),
  );
  const canvas = (await page.getByTestId("broadcast-canvas").boundingBox())!;
  expect(frames[0]!.width).toBeGreaterThan(canvas.width * 0.44);
  expect(frames[0]!.height).toBeGreaterThan(canvas.height * 0.44);
  expect(Math.abs(frames[0]!.x - frames[1]!.x)).toBeLessThan(1);
  const program = (await page.getByTestId("broadcast-canvas").boundingBox())!;
  expect(frames[0]!.x).toBeCloseTo(program.x, 1);
  expect(frames[0]!.y).toBeCloseTo(program.y, 1);
  expect(frames[0]!.height).toBeCloseTo(program.height / 2, 1);
  expect(frames[0]!.y + frames[0]!.height).toBeCloseTo(frames[1]!.y, 1);
  expect(frames[1]!.y + frames[1]!.height).toBeCloseTo(
    program.y + program.height,
    1,
  );
  const rail = (await page.getByTestId("program-side-rail").boundingBox())!;
  expect(frames[0]!.x + frames[0]!.width).toBeCloseTo(rail.x, 1);
  const proof = testInfo.outputPath("tapo-and-rtsp-program.png");
  await verifySponsor(page);
  await page.getByTestId("broadcast-canvas").screenshot({ path: proof });
  await testInfo.attach("tapo-and-rtsp-program", {
    path: proof,
    contentType: "image/png",
  });
  expect(fixture.errors).toEqual([]);
});

test("IP digital zoom changes only the selected picture without restarting its transport", async ({
  page,
}, testInfo) => {
  const fixture = await install(page, ["tapo", "rtsp"]);
  for (const role of roles) await verifyFrame(page, role);
  const camera = panel(page, "camera-home").getByRole("img", {
    name: "IP camera",
  });
  await camera.evaluate((canvas) => {
    canvas.setAttribute("data-zoom-lifetime", "original");
  });
  const before = await panel(page, "camera-home").boundingBox();
  const beforeFrames = fixture.accepted.filter(
    (observation) => observation.cameraRole === "camera-home",
  ).length;
  fixture.sources["camera-home"].zoom = 2;
  await expect(camera).toHaveCSS("transform", "matrix(2, 0, 0, 2, 0, 0)");
  await expect(camera).toHaveAttribute("data-zoom-lifetime", "original");
  expect(await panel(page, "camera-home").boundingBox()).toEqual(before);
  const { data, info } = await sharp(
    await panel(page, "camera-home").screenshot(),
  )
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (const fraction of [0.08, 0.5, 0.92]) {
    const pixel =
      (Math.floor(info.height / 2) * info.width +
        Math.floor(info.width * fraction)) *
      info.channels;
    // The full frame has blue/green edges; 2x shows the red central region.
    expect(data[pixel]).toBeGreaterThan(data[pixel + 1] + 70);
    expect(data[pixel]).toBeGreaterThan(data[pixel + 2] + 70);
  }
  await verifyFrame(page, "camera-away");
  await verifySponsor(page);
  await expect
    .poll(
      () =>
        fixture.accepted.filter((value) => value.cameraRole === "camera-home")
          .length,
    )
    .toBeGreaterThan(beforeFrames);
  const proof = testInfo.outputPath("ip-camera-digital-zoom.png");
  await page.getByTestId("broadcast-canvas").screenshot({ path: proof });
  await testInfo.attach("ip-camera-digital-zoom", {
    path: proof,
    contentType: "image/png",
  });
  fixture.sources["camera-home"].zoom = 1;
  await expect(camera).toHaveCSS("transform", "none");
  await verifyFrame(page, "camera-home");
  await expect(camera).toHaveAttribute("data-zoom-lifetime", "original");
  expect(
    fixture.frameRequests.filter(
      (request) => request.role === "camera-home" && request.after === 0,
    ),
  ).toHaveLength(1);
  expect(fixture.sources["camera-home"].generation).toBe(1);
  expect((await fixture.maxActive())["camera-home"]).toBe(1);
  expect((await fixture.phones()).starts).toEqual({});
  expect(fixture.errors).toEqual([]);
});

test("program flushes a changed source and rejects stale, repeated and undecodable camera frames", async ({
  page,
}) => {
  const fixture = await install(page, ["phone", "tapo"]);
  await verifyFrame(page, "camera-away");
  fixture.mode["camera-away"] = "old-generation";
  fixture.sources["camera-away"] = snapshot("tapo", 2);
  await expect(
    panel(page, "camera-away").getByRole("img", { name: "IP camera" }),
  ).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(
    fixture.accepted.filter(
      (v) => v.cameraRole === "camera-away" && v.sourceGeneration === 2,
    ),
  ).toHaveLength(0);
  fixture.mode["camera-away"] = "invalid";
  await page.waitForTimeout(250);
  expect(
    fixture.accepted.filter(
      (v) => v.cameraRole === "camera-away" && v.sourceGeneration === 2,
    ),
  ).toHaveLength(0);
  fixture.mode["camera-away"] = "live";
  await verifyFrame(page, "camera-away");
  await expect
    .poll(
      () =>
        fixture.accepted.filter(
          (v) => v.cameraRole === "camera-away" && v.sourceGeneration === 2,
        ).length,
    )
    .toBeGreaterThan(0);
  fixture.mode["camera-away"] = "repeated";
  // Repeated counters must not refresh proof; a stale displayed frame expires.
  await expect(
    panel(page, "camera-away").getByRole("img", { name: "IP camera" }),
  ).toHaveCount(0, { timeout: 7500 });
  const last = fixture.accepted
    .filter((v) => v.cameraRole === "camera-away")
    .at(-1);
  await page.waitForTimeout(200);
  expect(
    fixture.accepted.filter((v) => v.cameraRole === "camera-away").at(-1),
  ).toEqual(last);
  expect((await fixture.phones()).starts["camera-home"]).toBe(1);
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test("renderer health remains independent of stalled game and source reads and reports stopped animation frames", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const fixture = window as unknown as {
      __metadata: { calls: Record<string, number>; aborts: string[] };
      __pauseHealthRaf: boolean;
    };
    fixture.__metadata = { calls: {}, aborts: [] };
    const fetcher = window.fetch.bind(window);
    window.fetch = (input, options) => {
      const path = String(input);
      if (path === "/program" || path === "/camera-inputs") {
        fixture.__metadata.calls[path] =
          (fixture.__metadata.calls[path] ?? 0) + 1;
        if (fixture.__metadata.calls[path] === 1)
          return new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => {
                fixture.__metadata.aborts.push(path);
                reject(
                  new DOMException(
                    "Synthetic stalled metadata aborted",
                    "AbortError",
                  ),
                );
              },
              { once: true },
            );
          });
      }
      return fetcher(input, options);
    };
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (callback) =>
      raf((at) => {
        if (!fixture.__pauseHealthRaf) callback(at);
      });
  });
  const fixture = await install(page, ["tapo", "rtsp"]);
  await expect.poll(() => fixture.heartbeats.length).toBeGreaterThan(3);
  expect(fixture.heartbeats[2].frames).toBeGreaterThan(
    fixture.heartbeats[1].frames,
  );
  expect(new Set(fixture.heartbeats.map((body) => body.instance)).size).toBe(1);
  expect(
    fixture.heartbeats.every(
      (body) =>
        Object.keys(body).sort().join() === "action,frames,instance,visibility",
    ),
  ).toBe(true);
  expect(
    fixture.heartbeats.every(
      (body) =>
        body.action === "renderer-heartbeat" && body.visibility === "visible",
    ),
  ).toBe(true);
  const metadata = await page.evaluate(
    () =>
      (
        window as unknown as {
          __metadata: { calls: Record<string, number>; aborts: string[] };
        }
      ).__metadata,
  );
  expect(metadata.aborts.sort()).toEqual(["/camera-inputs", "/program"]);
  expect(metadata.calls["/program"]).toBeGreaterThan(1);
  expect(metadata.calls["/camera-inputs"]).toBeGreaterThan(1);
  for (const role of roles) await verifyFrame(page, role);
  await page.evaluate(() => {
    (window as unknown as { __pauseHealthRaf: boolean }).__pauseHealthRaf =
      true;
  });
  const count = fixture.heartbeats.length;
  await expect.poll(() => fixture.heartbeats.length).toBeGreaterThan(count + 2);
  const recent = fixture.heartbeats.slice(-2);
  expect(recent[0].frames).toBe(recent[1].frames);
  expect(fixture.errors).toEqual([]);
});

for (const cancellation of ["timeout", "source change"] as const) {
  test(`a stalled IP bitmap closes once without painting after ${cancellation}`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const decode = window.createImageBitmap.bind(window);
      let lateBitmap: ImageBitmap | undefined;
      const draw = CanvasRenderingContext2D.prototype.drawImage;
      const tracking = window as unknown as { __lateDraws: number };
      tracking.__lateDraws = 0;
      CanvasRenderingContext2D.prototype.drawImage = function (
        this: CanvasRenderingContext2D,
        image: CanvasImageSource,
        ...coordinates: number[]
      ) {
        if (image === lateBitmap) tracking.__lateDraws++;
        return Reflect.apply(draw, this, [image, ...coordinates]);
      } as typeof CanvasRenderingContext2D.prototype.drawImage;
      const fixture = window as unknown as {
        __decodeStall?: { finish: () => void; closes: number };
      };
      window.createImageBitmap = ((blob: Blob) => {
        if (!fixture.__decodeStall) {
          let finish!: () => void;
          const pending = decode(blob);
          const result = new Promise<ImageBitmap>((resolve) => {
            finish = () => {
              void pending.then((bitmap) => {
                lateBitmap = bitmap;
                const close = bitmap.close.bind(bitmap);
                bitmap.close = () => {
                  fixture.__decodeStall!.closes++;
                  close();
                };
                resolve(bitmap);
              });
            };
          });
          fixture.__decodeStall = { finish, closes: 0 };
          return result;
        }
        return decode(blob);
      }) as typeof window.createImageBitmap;
    });
    const fixture = await install(page, ["tapo", "rtsp"]);
    if (cancellation === "source change") {
      await expect
        .poll(() =>
          page.evaluate(() =>
            Boolean(
              (window as unknown as { __decodeStall?: unknown }).__decodeStall,
            ),
          ),
        )
        .toBe(true);
      fixture.sources["camera-home"] = snapshot("tapo", 2);
      fixture.sources["camera-away"] = snapshot("rtsp", 2);
      for (const role of roles)
        await expect
          .poll(
            () =>
              fixture.accepted.filter(
                (value) =>
                  value.cameraRole === role && value.sourceGeneration === 2,
              ).length,
          )
          .toBeGreaterThan(0);
    }
    for (const role of roles) {
      await expect
        .poll(
          () =>
            fixture.accepted.filter((value) => value.cameraRole === role)
              .length,
        )
        .toBeGreaterThan(0);
      await verifyFrame(page, role);
    }
    await page.evaluate(() =>
      (
        window as unknown as { __decodeStall: { finish: () => void } }
      ).__decodeStall.finish(),
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __decodeStall: { closes: number } })
              .__decodeStall.closes,
        ),
      )
      .toBe(1);
    for (const role of roles) {
      await verifyFrame(page, role);
      expect((await fixture.maxActive())[role]).toBe(1);
    }
    expect(
      await page.evaluate(
        () => (window as unknown as { __lateDraws: number }).__lateDraws,
      ),
    ).toBe(0);
    expect(fixture.errors).toEqual([]);
  });
}
test("IP canvas updates pixels and resolution in place, recovers stale frames, and releases replaced sources", async ({
  page,
}) => {
  const fixture = await install(page, ["tapo", "rtsp"]);
  const camera = panel(page, "camera-away").getByRole("img", {
    name: "IP camera",
  });
  await verifyFrame(page, "camera-away");
  const original = await camera.elementHandle();
  await original!.evaluate((canvas: HTMLCanvasElement) => {
    const state = window as unknown as {
      __cameraCanvas: HTMLCanvasElement;
      __dimensionWrites: number;
    };
    state.__cameraCanvas = canvas;
    state.__dimensionWrites = 0;
    for (const key of ["width", "height"] as const) {
      const descriptor = Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        key,
      )!;
      Object.defineProperty(canvas, key, {
        get() {
          return descriptor.get!.call(this);
        },
        set(value) {
          state.__dimensionWrites++;
          descriptor.set!.call(this, value);
        },
      });
    }
  });
  const blue = await sharp({
    create: { width: 320, height: 180, channels: 3, background: "#145ee5" },
  })
    .jpeg()
    .toBuffer();
  fixture.frames["camera-away"] = blue;
  await expect
    .poll(() =>
      camera.evaluate(
        (canvas: HTMLCanvasElement) =>
          canvas.getContext("2d")!.getImageData(160, 90, 1, 1).data[2],
      ),
    )
    .toBeGreaterThan(200);
  expect(
    await camera.evaluate(
      (canvas) =>
        canvas ===
        (window as unknown as { __cameraCanvas: HTMLCanvasElement })
          .__cameraCanvas,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __dimensionWrites: number }).__dimensionWrites,
    ),
  ).toBe(0);
  fixture.frames["camera-away"] = await sharp({
    create: { width: 90, height: 160, channels: 3, background: "#19be35" },
  })
    .jpeg()
    .toBuffer();
  await expect
    .poll(() =>
      camera.evaluate((canvas: HTMLCanvasElement) => [
        canvas.width,
        canvas.height,
      ]),
    )
    .toEqual([90, 160]);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __dimensionWrites: number }).__dimensionWrites,
    ),
  ).toBe(2);
  expect(
    await camera.evaluate(
      (canvas) =>
        canvas ===
        (window as unknown as { __cameraCanvas: HTMLCanvasElement })
          .__cameraCanvas,
    ),
  ).toBe(true);
  fixture.mode["camera-away"] = "absent";
  await expect(camera).toHaveCount(0, { timeout: 7500 });
  expect(
    await original!.evaluate((canvas: HTMLCanvasElement) => canvas.isConnected),
  ).toBe(false);
  fixture.mode["camera-away"] = "live";
  await expect(camera).toBeVisible();
  expect(
    await camera.evaluate(
      (canvas) =>
        canvas ===
        (window as unknown as { __cameraCanvas: HTMLCanvasElement })
          .__cameraCanvas,
    ),
  ).toBe(true);
  fixture.sources["camera-away"] = snapshot("tapo", 2);
  await expect
    .poll(() =>
      original!.evaluate((canvas: HTMLCanvasElement) => [
        canvas.width,
        canvas.height,
        canvas.isConnected,
      ]),
    )
    .toEqual([0, 0, false]);
  await expect(camera).toBeVisible();
  expect(
    await camera.evaluate(
      (canvas) =>
        canvas ===
        (window as unknown as { __cameraCanvas: HTMLCanvasElement })
          .__cameraCanvas,
    ),
  ).toBe(false);
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test("two stalled bitmap decodes cap retained work and late release resumes polling", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const decode = window.createImageBitmap.bind(window);
    const state = { started: 0, closes: 0, finishes: [] as Array<() => void> };
    (window as unknown as { __bitmapCap: typeof state }).__bitmapCap = state;
    window.createImageBitmap = ((blob: Blob) => {
      state.started++;
      if (state.started > 2) return decode(blob);
      const pending = decode(blob);
      return new Promise<ImageBitmap>((resolve) => {
        state.finishes.push(() => {
          void pending.then((bitmap) => {
            const close = bitmap.close.bind(bitmap);
            bitmap.close = () => {
              state.closes++;
              close();
            };
            resolve(bitmap);
          });
        });
      });
    }) as typeof window.createImageBitmap;
  });
  const fixture = await install(page, ["phone", "tapo"]);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __bitmapCap: { started: number } })
            .__bitmapCap.started,
      ),
    )
    .toBe(2);
  await page.waitForTimeout(2300);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __bitmapCap: { started: number } }).__bitmapCap
          .started,
    ),
  ).toBe(2);
  expect(
    fixture.accepted.filter((value) => value.cameraRole === "camera-away"),
  ).toHaveLength(0);
  await expect(
    panel(page, "camera-away").getByRole("img", { name: "IP camera" }),
  ).toHaveCount(0);
  await page.evaluate(() =>
    (
      window as unknown as { __bitmapCap: { finishes: Array<() => void> } }
    ).__bitmapCap.finishes.forEach((finish) => finish()),
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __bitmapCap: { closes: number } }).__bitmapCap
            .closes,
      ),
    )
    .toBe(2);
  await verifyFrame(page, "camera-away");
  await expect
    .poll(
      () =>
        fixture.accepted.filter((value) => value.cameraRole === "camera-away")
          .length,
    )
    .toBeGreaterThan(0);
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
  expect(fixture.errors).toEqual([]);
});

test("completed camera observations drain their bodies and release attempt signals", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const records: Array<{ response: Response; signal: AbortSignal }> = [];
    (
      window as unknown as { __observationLifetimes: typeof records }
    ).__observationLifetimes = records;
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (
        String(input) === "/camera" &&
        options?.method === "POST" &&
        options.signal
      )
        records.push({ response, signal: options.signal });
      return response;
    };
  });
  const fixture = await install(page, ["tapo", "rtsp"]);
  await verifyFrame(page, "camera-away");
  await expect
    .poll(() =>
      page.evaluate(() => {
        const records = (
          window as unknown as {
            __observationLifetimes: Array<{
              response: Response;
              signal: AbortSignal;
            }>;
          }
        ).__observationLifetimes;
        return records.filter(
          (row) => row.response.bodyUsed && row.signal.aborted,
        ).length;
      }),
    )
    .toBeGreaterThan(4);
  expect(fixture.errors).toEqual([]);
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
});

test("a stalled observation response body expires under the frame deadline and polling recovers", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const state = {
      stalled: false,
      cameraRole: null as string | null,
      bodyRead: false,
      aborted: false,
      abortAfterMs: 0,
    };
    (
      window as unknown as { __observationBodyStall: typeof state }
    ).__observationBodyStall = state;
    window.fetch = async (input, options) => {
      const response = await original(input, options);
      if (
        String(input) !== "/camera" ||
        !options?.body ||
        JSON.parse(options.body as string).action !== "observe" ||
        // The phone fixture has a separate five-second observation deadline.
        JSON.parse(options.body as string).cameraRole !== "camera-away" ||
        state.stalled
      )
        return response;
      state.stalled = true;
      state.cameraRole = JSON.parse(options.body as string).cameraRole;
      await response.text();
      const bodyStarted = performance.now();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
          options.signal!.addEventListener(
            "abort",
            () => {
              state.aborted = true;
              state.abortAfterMs = performance.now() - bodyStarted;
              controller.error(
                new DOMException("synthetic body deadline", "AbortError"),
              );
            },
            { once: true },
          );
        },
        pull() {
          state.bodyRead = true;
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/json" },
      });
    };
  });
  const fixture = await install(page, ["phone", "tapo"]);
  await verifyFrame(page, "camera-away");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as unknown as {
              __observationBodyStall: {
                cameraRole: string | null;
                bodyRead: boolean;
                aborted: boolean;
              };
            }
          ).__observationBodyStall,
      ),
    )
    .toMatchObject({
      cameraRole: "camera-away",
      bodyRead: true,
      aborted: true,
    });
  const abortAfterMs = await page.evaluate(
    () =>
      (
        window as unknown as {
          __observationBodyStall: { abortAfterMs: number };
        }
      ).__observationBodyStall.abortAfterMs,
  );
  expect(abortAfterMs).toBeGreaterThan(1000);
  expect(abortAfterMs).toBeLessThan(3000);
  await expect
    .poll(
      () =>
        fixture.accepted.filter((value) => value.cameraRole === "camera-away")
          .length,
    )
    .toBeGreaterThan(2);
  await verifyFrame(page, "camera-away");
  expect((await fixture.maxActive())["camera-away"]).toBe(1);
  expect(fixture.errors).toEqual([]);
});
