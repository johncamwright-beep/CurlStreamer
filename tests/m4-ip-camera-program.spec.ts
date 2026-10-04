import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import sharp from "sharp";
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
  kind: "phone" | "tapo",
  generation: number,
): M4CameraInputSnapshot => ({
  kind,
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
  sponsors: [],
  sponsorMode: {
    active: false,
    style: "overlay",
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
  kinds: ["phone" | "tapo", "phone" | "tapo"],
) {
  const sources: Record<Role, M4CameraInputSnapshot> = {
    "camera-home": snapshot(kinds[0], 1),
    "camera-away": snapshot(kinds[1], 1),
  };
  const mode: Record<
    Role,
    "live" | "absent" | "old-generation" | "repeated" | "invalid"
  > = { "camera-home": "live", "camera-away": "live" };
  const counter: Record<Role, number> = { "camera-home": 0, "camera-away": 0 };
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
      const source = { ...sources[frameRole] },
        behavior = mode[frameRole];
      try {
        await new Promise((resolve) => setTimeout(resolve, 35));
        if (behavior === "absent") return await route.fulfill({ status: 204 });
        const currentCounter =
          behavior === "repeated" ? counter[frameRole] : ++counter[frameRole];
        const body =
          behavior === "invalid" ? Buffer.from("invalid JPEG fixture") : jpeg;
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
  await expect(page.getByTestId("broadcast-canvas")).toBeVisible();
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
  return { sources, mode, observations, accepted, errors, maxActive, phones };
}

const panel = (page: Page, role: Role) =>
  page.getByTestId(`camera-panel-${role}`);

async function verifyFrame(page: Page, role: Role) {
  const image = panel(page, role).getByAltText("Tapo camera");
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate(
        (element: HTMLImageElement) => element.complete && element.naturalWidth,
      ),
    )
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
    panel(page, "camera-away").getByAltText("Tapo camera"),
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

test("program composes both Tapo slots with full image edges and one frame request per role", async ({
  page,
}, testInfo) => {
  const fixture = await install(page, ["tapo", "tapo"]);
  for (const role of roles) await verifyFrame(page, role);
  for (const role of roles) {
    await expect
      .poll(() => fixture.accepted.filter((v) => v.cameraRole === role).length)
      .toBeGreaterThan(1);
    expect((await fixture.maxActive())[role]).toBe(1);
  }
  expect((await fixture.phones()).starts).toEqual({});
  const proof = testInfo.outputPath("two-tapo-program.png");
  await page.getByTestId("broadcast-canvas").screenshot({ path: proof });
  await testInfo.attach("two-tapo-program", {
    path: proof,
    contentType: "image/png",
  });
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
    panel(page, "camera-away").getByAltText("Tapo camera"),
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
    panel(page, "camera-away").getByAltText("Tapo camera"),
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
