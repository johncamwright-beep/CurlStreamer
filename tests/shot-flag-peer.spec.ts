import { expect, test } from "@playwright/test";
import { build } from "esbuild";
import { createHash } from "node:crypto";

const gameId = "11111111-1111-4111-8111-111111111111";
const clipId = "22222222-2222-4222-8222-222222222222";

// Only signaling is mocked. The two browser pages exchange the clip through
// real RTCPeerConnections, with no TURN server or application media endpoint.
const signalingFixture = `
export const RoomEvent = { Disconnected: "disconnected" };
export class Room {
  async connect(url, role) {
    this.role = role;
    const gameId = '${gameId}';
    const studioId = 'studio-' + gameId;
    const coachId = 'coach-fixture';
    this.identity = role === 'studio' ? studioId : coachId;
    const meta = (role) => JSON.stringify({role, gameId, expiresAt: Date.now() + 120000});
    this.remoteParticipants = new Map([[studioId, {metadata:meta('studio')}], [coachId, {metadata:meta('coach')}]]);
    this.bus = new BroadcastChannel('shot-flag-fixture');
    this.bus.onmessage = async ({data}) => {
      if (data.target !== this.identity) return;
      if (data.type === 'request' && this.handler) {
        try {
          const answer = await this.handler({callerIdentity:data.source, payload:data.payload});
          this.bus.postMessage({type:'answer', target:data.source, id:data.id, answer});
        } catch (error) {
          this.bus.postMessage({type:'answer', target:data.source, id:data.id, error:error.message});
        }
      }
    };
    this.localParticipant = { performRpc: ({destinationIdentity,payload}) => new Promise((resolve,reject) => {
      const id = crypto.randomUUID();
      this.bus.addEventListener('message', ({data}) => {
        if (data.type === 'answer' && data.id === id) data.error ? reject(Error(data.error)) : resolve(data.answer);
      });
      this.bus.postMessage({type:'request', target:destinationIdentity, source:this.identity, id, payload});
    })};
  }
  registerRpcMethod(method,handler) {
    this.handler = handler;
    document.querySelector('output').textContent = 'Studio ready';
  }
  once(event, callback) { this.onDisconnect = callback; }
  async disconnect() { this.bus?.close(); this.onDisconnect?.(); }
}
`;

test("authorized Shot Flags receives bytes from Studio through a direct data channel", async ({
  context,
  page,
}) => {
  const source = Buffer.alloc(512 * 1024);
  for (let i = 0; i < source.length; i++) source[i] = (i * 17) % 253;
  const checksum = createHash("sha256").update(source).digest("hex");
  const bundle = await build({
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    tsconfig: "tsconfig.json",
    plugins: [
      {
        name: "clip-signaling-fixture",
        setup(plugin) {
          plugin.onResolve({ filter: /^livekit-client$/ }, () => ({
            path: "livekit-client",
            namespace: "clip-fixture",
          }));
          plugin.onLoad({ filter: /.*/, namespace: "clip-fixture" }, () => ({
            contents: signalingFixture,
          }));
        },
      },
    ],
    stdin: {
      resolveDir: process.cwd(),
      contents: `
import { captureShotFlagClip, serveShotFlagClips } from './src/lib/curlcoach/shot-flag-clip';
const gameId = '${gameId}';
const out = document.querySelector('output');
const signal = AbortSignal.timeout(25000);
if (location.pathname === '/flag-studio-fixture') {
  window.chrome = { webview: { postMessage({type, nonce, gameId: requestedGame}) {
    if (type !== 'studio-coach-capture' || requestedGame !== gameId) return;
    window.dispatchEvent(new CustomEvent('studio-coach-capture-result', {detail:{
      gameId, nonce, ok:true, clipId:'${clipId}', duration:15, minimum:0, capturedAt:'2026-11-11T12:00:00Z'
    }}));
  }}};
  serveShotFlagClips(gameId, signal).catch((error) => out.textContent = error.message);
} else {
  document.querySelector('button').onclick = async () => {
    out.textContent = 'Capturing';
    try {
      const clip = await captureShotFlagClip(gameId, signal);
      const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', await clip.video.arrayBuffer()));
      out.textContent = clip.duration + 's ' + [...sha].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch (error) { out.textContent = error.message; }
  };
}
`,
    },
  });
  let localReads = 0;
  const grants: unknown[] = [];
  await context.route("**/api/curlcoach/clip-relay", (route) => {
    const request = route.request().postDataJSON();
    grants.push(request);
    return route.fulfill({
      json: { url: "wss://signal.invalid", token: request.role },
    });
  });
  await context.route(`**/__studio-coach-clip/${gameId}/${clipId}`, (route) => {
    localReads++;
    expect(new URL(route.request().frame().url()).pathname).toBe(
      "/flag-studio-fixture",
    );
    return route.fulfill({
      body: source,
      contentType: "video/mp4",
      headers: { "content-length": String(source.length) },
    });
  });
  await context.route(/\/flag-(studio|coach)-fixture$/, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<button>Select Flag Start</button><output></output><script>${bundle.outputFiles[0].text}</script>`,
    }),
  );
  const studio = await context.newPage();
  await studio.goto("/flag-studio-fixture");
  await expect(studio.locator("output")).toHaveText("Studio ready");
  await page.goto("/flag-coach-fixture");
  await page.getByRole("button", { name: "Select Flag Start" }).click();
  await expect(page.locator("output")).toHaveText(`15s ${checksum}`, {
    timeout: 20_000,
  });
  expect(localReads).toBe(1);
  expect(grants).toEqual([
    { gameId, role: "studio" },
    { gameId, role: "coach" },
  ]);
});
