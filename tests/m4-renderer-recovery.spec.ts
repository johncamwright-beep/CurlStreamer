import { test, expect, type Page } from "@playwright/test";
import { build } from "esbuild";

test.beforeEach(async ({ page }) => {
  const phone = {
    kind: "phone",
    host: null,
    stream: null,
    rotation: 0,
    configured: true,
    phase: "idle",
    errorCode: null,
    generation: 0,
  };
  await page.route("**/camera-inputs", (route) =>
    route.fulfill({
      json: { cameras: { "camera-home": phone, "camera-away": phone } },
    }),
  );
});

test("native renderer retries a camera that stops before its setup promise settles", async ({
  page,
}) => {
  const diagnostics: unknown[] = [];
  const bundle = await build({
    entryPoints: ["src/lib/providers/m4-program-renderer-browser.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "early-camera-failure",
        setup(builder) {
          const mocks: Record<string, string> = {
            "./m4-program-camera": `export async function connectM4ProgramCamera(options){ const attempts=window.__attempts??=( {} ); attempts[options.role]=(attempts[options.role]??0)+1; if(options.role==='camera-home'&&attempts[options.role]===1)options.onStop('Direct path verification timed out. Reconnect the camera.');else { const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;canvas.getContext('2d').fillRect(0,0,90,160);options.onVideo(canvas.captureStream(1)); } return {stop(){}}; }`,
            "@/components/ProgramCanvas": `import React from 'react';export function ProgramCanvas({renderCamera}){return <main>{['camera-home','camera-away'].map(role=><div key={role} data-testid={role}>{renderCamera(role)}</div>)}</main>}`,
            "@/components/ProgramPhoneAudio":
              "export function ProgramPhoneAudio(){return null}",
            "@/components/ProgramUsbAudio":
              "export function ProgramUsbAudio(){return null}",
          };
          builder.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await page.route("**/renderer-recovery-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/renderer-recovery-fixture.js"></script>',
    }),
  );
  await page.route("**/renderer-recovery-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route("**/program", (route) =>
    route.fulfill({ json: { game: { broadcast: "idle" } } }),
  );
  await page.route("**/camera", (route) => {
    diagnostics.push(route.request().postDataJSON());
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/renderer-recovery-fixture");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __attempts: Record<string, number> })
            .__attempts?.["camera-home"],
      ),
    )
    .toBe(2);
  await expect(
    page
      .getByTestId("camera-home")
      .getByText("Camera not connected", { exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __attempts: Record<string, number> })
          .__attempts["camera-away"],
    ),
  ).toBe(1);
  expect(diagnostics).toContainEqual({
    action: "diagnostic",
    event: { layer: "peer", code: "verification_timeout", role: "camera-home" },
  });
});

async function installRecoveryFixture(
  page: Page,
  providerMocks: Record<string, string>,
) {
  const mocks: Record<string, string> = {
    "@/components/ProgramCanvas": `import React from 'react';export function ProgramCanvas({renderCamera,audioStatus}){return <main><output data-testid="verification">{audioStatus}</output>{['camera-home','camera-away'].map(role=><div key={role} data-testid={role}>{renderCamera(role)}</div>)}</main>}`,
    "@/components/ProgramPhoneAudio":
      "export function ProgramPhoneAudio(){return null}",
    "@/components/ProgramUsbAudio":
      "export function ProgramUsbAudio(){return null}",
    ...providerMocks,
  };
  const bundle = await build({
    entryPoints: ["src/lib/providers/m4-program-renderer-browser.tsx"],
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    plugins: [
      {
        name: "coordinator-recovery",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) =>
            mocks[args.path]
              ? { path: args.path, namespace: "fixture" }
              : undefined,
          );
          builder.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            contents: mocks[args.path],
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  await page.route("**/renderer-recovery-fixture", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<div id="root"></div><script src="/renderer-recovery-fixture.js"></script>',
    }),
  );
  await page.route("**/renderer-recovery-fixture.js", (route) =>
    route.fulfill({
      contentType: "text/javascript",
      body: bundle.outputFiles[0].text,
    }),
  );
  await page.route("**/program", (route) =>
    route.fulfill({
      json: { game: { broadcast: "idle" } },
    }),
  );
}

test("native renderer blocks local authority rejection while a temporary outage recovers the other role", async ({
  page,
}) => {
  await installRecoveryFixture(page, {
    "./direct-peer": `
      export class DirectPeer {
        constructor(options) {
          this.options=options;
          const f=window.__authorityRecovery??={created:0,closed:0};
          f.created++;
        }
        inspect(){return Promise.resolve({direct:true,framesDecoded:1,bytesReceived:1,connectionState:'connected',iceConnectionState:'connected'})}
        receive(){
          const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
          this.options.onVideo(canvas.captureStream(1));
          return Promise.resolve();
        }
        close(){window.__authorityRecovery.closed++}
      }`,
  });
  const attempts: Record<string, number> = {};
  const diagnostics: Array<{
    action: string;
    event?: { role: string; code: string };
  }> = [];
  const ticket = {
    cameraRole: "camera-away",
    sessionId: "22222222-2222-4222-8222-222222222222",
    generation: 1,
    negotiationId: "33333333-3333-4333-8333-333333333333",
    assignmentGeneration: 1,
    expiresAt: Date.now() + 20000,
  };
  await page.route("**/camera", (route) => {
    const body = route.request().postDataJSON();
    if (body.action === "diagnostic") diagnostics.push(body);
    if (body.action !== "connect") return route.fulfill({ json: { ok: true } });
    attempts[body.cameraRole] = (attempts[body.cameraRole] ?? 0) + 1;
    if (body.cameraRole === "camera-home")
      return route.fulfill({
        status: 403,
        json: { error: "Program unavailable" },
      });
    if (attempts[body.cameraRole] === 1)
      return route.fulfill({
        status: 503,
        json: { error: "Program unavailable" },
      });
    return route.fulfill({ json: ticket });
  });
  const drains: string[] = [];
  await page.route("**/events/*", (route) => {
    const role = new URL(route.request().url()).pathname.split("/").at(-1)!;
    drains.push(role);
    return route.fulfill({
      json: {
        events:
          drains.length === 1
            ? [
                {
                  ...ticket,
                  from: "camera",
                  messageId: "44444444-4444-4444-8444-444444444444",
                  expiresAt: Date.now() + 10000,
                  signal: { type: "ready" },
                },
              ]
            : [],
      },
    });
  });
  await page.goto("/renderer-recovery-fixture");
  await expect.poll(() => attempts["camera-away"]).toBe(2);
  await expect(
    page
      .getByTestId("camera-away")
      .getByText("Camera not connected", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page
      .getByTestId("camera-home")
      .getByText("Camera not connected", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("verification")).toHaveText(
    "1/2 cameras receiving",
  );
  // Several retry intervals pass after recovery; explicit denial must remain blocked.
  await page.waitForTimeout(3200);
  expect(attempts).toEqual({ "camera-home": 1, "camera-away": 2 });
  expect(drains.length).toBeGreaterThan(1);
  expect(drains.every((role) => role === "camera-away")).toBe(true);
  expect(
    await page.evaluate(() => (window as any).__authorityRecovery),
  ).toEqual({ created: 1, closed: 0 });
  expect(
    diagnostics.some(
      (body) =>
        body.event?.role === "camera-home" &&
        body.event.code === "authority_rejected",
    ),
  ).toBe(true);
  expect(
    diagnostics.some(
      (body) =>
        body.event?.role === "camera-home" && body.event.code === "retry",
    ),
  ).toBe(false);
  expect(
    diagnostics.some(
      (body) =>
        body.event?.role === "camera-away" && body.event.code === "retry",
    ),
  ).toBe(true);
});

test("native renderer waits for canceled setup to settle and fences every retired callback", async ({
  page,
}) => {
  await installRecoveryFixture(page, {
    "./m4-program-camera": `
      export async function connectM4ProgramCamera(options) {
        const f=window.__recovery??={attempts:{},pending:0,maxPending:0,stops:[],aborts:[]};
        const n=f.attempts[options.role]=(f.attempts[options.role]??0)+1;
        if(options.role==='camera-home') { f.pending++; f.maxPending=Math.max(f.maxPending,f.pending); }
        options.signal.addEventListener('abort',()=>f.aborts.push(options.role+':'+n),{once:true});
        const handle={stop(){f.stops.push(options.role+':'+n)}};
        if(options.role==='camera-home'&&n===1) {
          f.retired=options;
          f.failFirst=()=>options.onStop('Direct path verification timed out. Reconnect the camera.');
          await new Promise(resolve=>{f.settleFirst=resolve});
        } else {
          const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
          options.onVideo(canvas.captureStream(1));
          options.onMetrics({direct:true,framesDecoded:1,bytesReceived:1,connectionState:'connected',iceConnectionState:'connected'});
        }
        if(options.role==='camera-home')f.pending--;
        return handle;
      }`,
  });
  await page.route("**/camera", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto("/renderer-recovery-fixture");
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__recovery?.attempts["camera-home"]),
    )
    .toBe(1);
  await page.evaluate(() => (window as any).__recovery.failFirst());
  await expect
    .poll(() => page.evaluate(() => (window as any).__recovery.aborts))
    .toContain("camera-home:1");
  // The backoff can expire, but replacement must await the retired setup's cleanup.
  await page.waitForTimeout(1300);
  expect(
    await page.evaluate(
      () => (window as any).__recovery.attempts["camera-home"],
    ),
  ).toBe(1);
  await page.evaluate(() => (window as any).__recovery.settleFirst());
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__recovery.attempts["camera-home"]),
    )
    .toBe(2);
  await expect(page.getByTestId("verification")).toHaveText(
    "2/2 cameras receiving",
  );
  await page.evaluate(() => {
    const f = (window as any).__recovery;
    f.currentVideo = document.querySelector<HTMLVideoElement>(
      '[data-testid="camera-home"] video',
    )?.srcObject;
    const canvas = document.createElement("canvas");
    const retiredVideo = canvas.captureStream(1);
    f.retired.onVideo(retiredVideo);
    f.retired.onAudio(retiredVideo);
    f.retired.onMetrics({ direct: false, framesDecoded: 0, bytesReceived: 0 });
    f.retired.onStop(
      "Direct path verification timed out. Reconnect the camera.",
    );
  });
  await page.waitForTimeout(1300);
  await expect(page.getByTestId("verification")).toHaveText(
    "2/2 cameras receiving",
  );
  expect(
    await page.evaluate(() => {
      const f = (window as any).__recovery;
      return {
        attempts: f.attempts,
        maxPending: f.maxPending,
        stops: f.stops,
        retainedVideo:
          document.querySelector<HTMLVideoElement>(
            '[data-testid="camera-home"] video',
          )?.srcObject === f.currentVideo,
      };
    }),
  ).toEqual({
    attempts: { "camera-home": 2, "camera-away": 1 },
    maxPending: 1,
    stops: ["camera-home:1"],
    retainedVideo: true,
  });
});

test("native camera aborts an old event drain before replacement signaling arrives", async ({
  page,
}) => {
  await installRecoveryFixture(page, {
    "./direct-peer": `
      export class DirectPeer {
        constructor(options) {
          this.options=options;
          const f=window.__relayRecovery??={peers:[],order:[],received:[]};
          this.id=f.peers.length+1;f.peers.push(this);f.order.push('open:'+this.id);
        }
        inspect(){return Promise.resolve({direct:true,framesDecoded:1,bytesReceived:1,connectionState:'connected',iceConnectionState:'connected'})}
        receive(signal){
          window.__relayRecovery.received.push({peer:this.id,signal});
          const canvas=document.createElement('canvas');canvas.width=90;canvas.height=160;
          this.options.onVideo(canvas.captureStream(1));
          return Promise.resolve();
        }
        close(){window.__relayRecovery.order.push('close:'+this.id)}
      }`,
  });
  const counts: Record<string, number> = {};
  const tickets = new Map<string, object>();
  let homeDrains = 0;
  await page.route("**/camera", async (route) => {
    const body = route.request().postDataJSON();
    if (body.action !== "connect") return route.fulfill({ json: { ok: true } });
    const role = body.cameraRole;
    if (role === "camera-away") await expect.poll(() => homeDrains).toBe(1);
    counts[role] = (counts[role] ?? 0) + 1;
    const ticket = {
      cameraRole: role,
      sessionId: "22222222-2222-4222-8222-222222222222",
      generation: 1,
      negotiationId:
        counts[role] === 1
          ? "33333333-3333-4333-8333-333333333333"
          : "55555555-5555-4555-8555-555555555555",
      assignmentGeneration: 1,
      expiresAt: Date.now() + 20000,
    };
    tickets.set(role, ticket);
    return route.fulfill({ json: ticket });
  });
  let releaseOldDrain!: () => Promise<void>;
  await page.route("**/events/*", async (route) => {
    const role = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (role === "camera-home" && ++homeDrains === 1) {
      releaseOldDrain = () =>
        route
          .fulfill({
            json: {
              events: [
                {
                  ...tickets.get(role),
                  from: "camera",
                  messageId: "44444444-4444-4444-8444-444444444444",
                  expiresAt: Date.now() + 10000,
                  signal: { type: "ready" },
                },
              ],
            },
          })
          .catch(() => undefined);
      return;
    }
    return route.fulfill({
      json: {
        events:
          role === "camera-home" && homeDrains === 2
            ? [
                {
                  ...tickets.get(role),
                  from: "camera",
                  messageId: "66666666-6666-4666-8666-666666666666",
                  expiresAt: Date.now() + 10000,
                  signal: { type: "ready" },
                },
              ]
            : [],
      },
    });
  });
  await page.goto("/renderer-recovery-fixture");
  await expect.poll(() => homeDrains).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).__relayRecovery?.peers.length),
    )
    .toBe(2);
  await page.evaluate(() =>
    (window as any).__relayRecovery.peers[0].options.onFailure(
      "Direct path verification timed out. Reconnect the camera.",
    ),
  );
  await expect.poll(() => counts["camera-home"]).toBe(2);
  await expect
    .poll(() => page.evaluate(() => (window as any).__relayRecovery.received))
    .toEqual([{ peer: 3, signal: { type: "ready" } }]);
  // Fulfill the obsolete HTTP read with replacement-generation signaling.
  await releaseOldDrain();
  await page.waitForTimeout(200);
  expect(
    await page.evaluate(() => (window as any).__relayRecovery.received),
  ).toEqual([{ peer: 3, signal: { type: "ready" } }]);
  expect(
    await page.evaluate(() => (window as any).__relayRecovery.order),
  ).toEqual(["open:1", "open:2", "close:1", "open:3"]);
  expect(counts).toEqual({ "camera-home": 2, "camera-away": 1 });
  await expect(
    page
      .getByTestId("camera-home")
      .getByText("Camera not connected", { exact: true }),
  ).toHaveCount(0);
});
