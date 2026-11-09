import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { startM4StudioRecorder } from "../src/lib/providers/m4-studio-recorder";
import { coachMp4Duration } from "../src/lib/providers/coach-mp4-duration";
const root = resolve("work/coach-adapter-evidence", randomUUID());
await mkdir(root, { recursive: true });
const server = createServer((_, res) => {
  res.setHeader("content-type", "text/html");
  res.end(
    '<body style="background:green;color:white;font:80px sans-serif">LOCAL ADAPTER TEST<script>setInterval(()=>document.body.firstChild.textContent="LOCAL ADAPTER TEST "+Date.now(),100)</script>',
  );
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
let recorder: Awaited<ReturnType<typeof startM4StudioRecorder>> | undefined;
try {
  recorder = await startM4StudioRecorder({
    executable: resolve(
      "work/coach-native-build/Release/m4_studio_recorder.exe",
    ),
    runtime:
      "C:/Users/john/AppData/Local/Programs/CurlStreamer Studio/obs/bin/64bit",
    recording: join(root, "test.mkv"),
    presentationControl: true,
    replayControl: true,
    coachControl: true,
    program: {
      url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
      cacheDirectory: join(root, "curlstreamer-m4-cef-" + "a".repeat(32)),
    },
  });
  await delay(6000);
  await recorder.coach!.capture();
  for (let i = 0; i < 60; i++) {
    if ((await recorder.coach!.status()).state === 3) break;
    await delay(200);
  }
  assert.equal((await recorder.coach!.status()).state, 3);
  assert(coachMp4Duration(await recorder.coach!.snapshot()) > 3);
  assert((await recorder.programHealth()).active);
  console.log(
    "Real Studio adapter capture, duration, and continued recording passed",
  );
} finally {
  await recorder?.stop();
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
}
