// Real browser regression with synthetic video; no physical camera or cloud service.
// SDP stays inside the test page. Return aggregate results only.
import { chromium } from "@playwright/test";
import { build } from "esbuild";
import type {
  DirectPeer,
  DirectMetrics,
} from "../src/lib/providers/direct-peer";
import type { StudioSignal } from "../src/lib/studio-protocol";

const bundle = await build({
  entryPoints: ["src/lib/providers/direct-peer.ts"],
  bundle: true,
  platform: "browser",
  format: "iife",
  globalName: "DirectPeerTest",
  write: false,
});
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  const page = await browser.newPage();
  await page.setContent(
    "<title>Synthetic camera retry regression</title><canvas width='720' height='1280'></canvas>",
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(async () => {
    const Peer = (
      window as unknown as { DirectPeerTest: { DirectPeer: typeof DirectPeer } }
    ).DirectPeerTest.DirectPeer;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    let frames = 0;
    const painting = setInterval(() => {
      ctx.fillStyle = frames++ % 2 ? "#047857" : "#075985";
      ctx.fillRect(0, 0, 720, 1280);
    }, 50);
    const [track] = canvas.captureStream(20).getVideoTracks();
    const offers: StudioSignal[] = [],
      answers: StudioSignal[] = [],
      failures: string[] = [];
    let presented = false;
    const receiver = new Peer({
      side: "receiver",
      send: async (s) => {
        offers.push(s);
      },
      onVideo: () => {
        presented = true;
      },
      onFailure: (reason) => {
        failures.push(reason);
      },
    });
    const camera = new Peer({
      side: "camera",
      track,
      send: async (s) => {
        answers.push(s);
      },
      onVideo: () => {},
      onFailure: (reason) => {
        failures.push(reason);
      },
    });
    let samples = 0;
    let last: DirectMetrics | undefined;
    try {
      await receiver.receive({ type: "ready" });
      await receiver.receive({ type: "ready" });
      for (const offer of offers) await camera.receive(offer);
      for (const answer of answers) await receiver.receive(answer);
      for (let i = 0; i < 30 && failures.length === 0; i++) {
        await new Promise((r) => setTimeout(r, 250));
        last = await receiver.inspect();
        await camera.inspect();
        if (last.direct) samples++;
      }
      return {
        offers: offers.length,
        answers: answers.length,
        failures,
        presented,
        verifiedSamples: samples,
        decodedFrames: last?.framesDecoded ?? 0,
        relayBytes: last?.relayBytes ?? 0,
      };
    } finally {
      clearInterval(painting);
      receiver.close();
      camera.close();
      track.stop();
    }
  });
  console.log(JSON.stringify(result));
  if (
    result.failures.length ||
    !result.presented ||
    result.verifiedSamples < 20 ||
    result.decodedFrames < 20 ||
    result.relayBytes !== 0
  )
    throw Error("Synthetic browser retry regression failed.");
} finally {
  await browser.close();
}
