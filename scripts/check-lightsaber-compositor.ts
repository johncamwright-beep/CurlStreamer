/** Deterministic browser-frame review of approved tracking/foreground against private test photo.
 * npm exec vite-node -- scripts/check-lightsaber-compositor.ts <private-prepared-head.png>
 * Only loopback serves the photo; no private image enters public assets.
 */
import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import foreground from "../src/lib/lightsaber-foreground.json";
const output = resolve(
  "work/celebration-qa/browser-video",
  (process.argv[3] ?? "").replace(/[^a-z0-9-]/gi, ""),
);
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `
import {drawLightsaberFrame,trimCelebrationHead} from './src/components/PlayerCelebration';
import {lightsaberHeadTransforms} from './src/lib/lightsaber-compositor';
import foreground from './src/lib/lightsaber-foreground.json';
const image=src=>new Promise((resolve,reject)=>{const value=new Image();value.onload=()=>resolve(value);value.onerror=reject;value.src=src;});
const video=document.querySelector('video'),canvas=document.querySelector('canvas'),context=canvas.getContext('2d');
const prepare=Promise.all([image('/qa/private-head.png'),...foreground.sheets.map(image),new Promise(resolve=>video.readyState>=2?resolve():video.addEventListener('loadeddata',resolve,{once:true}))]).then(([photo,...assets])=>{assets.pop();const head=trimCelebrationHead(photo);return {head,atlases:assets,transforms:lightsaberHeadTransforms(head.width/head.height)};});
window.qaDraw=async frame=>{const {head,atlases,transforms}=await prepare;const sought=new Promise(resolve=>video.requestVideoFrameCallback((_,metadata)=>resolve(metadata.mediaTime)));video.currentTime=(frame+.01)/30;await sought;drawLightsaberFrame(context,video,head,transforms[frame],atlases,frame);return {frame,headWidth:head.width,headHeight:head.height,transform:transforms[frame]};};
`,
    resolveDir: process.cwd(),
    loader: "ts",
  },
  bundle: true,
  platform: "browser",
  format: "iife",
  jsx: "automatic",
  write: false,
});
const privateHead = await readFile(
  process.argv[2] ?? resolve("work/cameron-starwars/cameron-cutout.png"),
);
const allowed = new Set(["/celebrations/lightsaber.mp4", ...foreground.sheets]);
const server = createServer(async (req, res) => {
  try {
    if (req.url === "/") {
      res.setHeader("content-type", "text/html");
      res.end(
        '<html><body style="margin:0;background:#000"><video muted preload="auto" src="/celebrations/lightsaber.mp4" style="display:none"></video><canvas width="1440" height="1080" style="display:block"></canvas><script src="/qa.js"></script></body></html>',
      );
      return;
    }
    if (req.url === "/qa.js") {
      res.setHeader("content-type", "text/javascript");
      res.end(bundle.outputFiles[0].contents);
      return;
    }
    if (req.url === "/qa/private-head.png") {
      res.setHeader("content-type", "image/png");
      res.end(privateHead);
      return;
    }
    if (allowed.has(req.url ?? "")) {
      const value = await readFile(resolve("public", req.url!.slice(1)));
      res.setHeader(
        "content-type",
        req.url!.endsWith(".mp4") ? "video/mp4" : "image/png",
      );
      const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
      if (range) {
        const start = Number(range[1]),
          end = range[2] ? Number(range[2]) : value.length - 1;
        res.writeHead(206, {
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${value.length}`,
          "content-length": end - start + 1,
        });
        res.end(value.subarray(start, end + 1));
        return;
      }
      res.setHeader("accept-ranges", "bytes");
      res.setHeader("content-length", value.length);
      res.end(value);
      return;
    }
    res.writeHead(404).end();
  } catch {
    res.writeHead(500).end();
  }
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string")
  throw Error("No QA server address");
const browser = await chromium.launch(
  process.platform === "win32" ? { channel: "msedge" } : {},
);
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1080 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${address.port}`);
  for (const frame of [36, 72, 74, 92, 128, 176]) {
    const info = await page.evaluate(
      async (frame) =>
        await (
          window as unknown as { qaDraw: (frame: number) => Promise<unknown> }
        ).qaDraw(frame),
      frame,
    );
    await page.locator("canvas").screenshot({
      path: resolve(output, `frame-${String(frame).padStart(3, "0")}.png`),
    });
    console.log(JSON.stringify(info));
  }
  if (errors.length) throw Error(errors.join("; "));
  console.log(`Browser compositor review frames: ${output}`);
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
