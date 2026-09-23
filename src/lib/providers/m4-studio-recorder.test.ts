import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { startM4StudioRecorder } from "./m4-studio-recorder";
import { M4DesktopClient } from "./m4-desktop-client";

const executable = process.env.CURLCAST_TEST_RECORDER_HOST;
const runtime = process.env.CURLCAST_TEST_OBS_RUNTIME;
const ffmpeg = process.env.CURLCAST_TEST_FFMPEG;
const streamPlugin = process.env.CURLCAST_TEST_DEFAULT_PLUGIN;
it("rejects private or remote program URLs before launching a recorder", async () => {
  for (const url of [
    "https://pilot.invalid/program#code=private",
    "http://127.0.0.1:3000/?token=private",
    "http://127.0.0.1:65536/",
  ]) {
    await expect(
      startM4StudioRecorder({
        executable: "C:\\unused.exe",
        runtime: "C:\\unused",
        recording: "C:\\unused.mkv",
        program: { url, cacheDirectory: "C:\\unused-cache" },
      }),
    ).rejects.toThrow("m4_recording_unavailable");
  }
});
describe.skipIf(
  !executable || !runtime || !ffmpeg || process.platform !== "win32",
)("real isolated Studio recorder (black/silent proof)", () => {
  it("records an isolated browser program with both complete colored panels", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-recorder-browser-"));
    const recording = join(directory, "browser.mkv");
    const server = createServer((_, response) => {
      response.writeHead(200, {
        "content-type": "text/html",
        "cache-control": "no-store",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
      });
      response.end(
        `<!doctype html><style>html,body{margin:0;width:100%;height:100%}.panel{position:absolute;left:0;top:0;width:50%;height:100%;background:rgb(255,0,0)!important}.panel+.panel{left:50%;background:rgb(0,255,0)!important}#ice{position:absolute;z-index:2;left:910px;top:50px;width:100px;height:100px;background:rgb(0,0,0)}</style><div class="panel"></div><div class="panel"></div><div id="ice"></div><script>const peer=new RTCPeerConnection({iceServers:[]});peer.createDataChannel("lan");peer.onicecandidate=event=>{if(event.candidate&&event.candidate.candidate.includes(" typ host "))document.getElementById("ice").style.background="rgb(0,0,255)"};peer.createOffer().then(offer=>peer.setLocalDescription(offer));</script>`,
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw Error();
    try {
      const recorder = await startM4StudioRecorder({
        executable: executable!,
        runtime: runtime!,
        recording,
        streamPlugin,
        program: {
          url: `http://127.0.0.1:${address.port}/`,
          cacheDirectory: join(directory, "fresh-cache"),
        },
      });
      try {
        if (recorder.stream) {
          expect(recorder.stream.snapshot()).toMatchObject({
            state: "idle",
            liveConfirmed: false,
          });
          await recorder.stream.stop();
          expect(recorder.stream.snapshot()).toMatchObject({
            state: "stopped",
            liveConfirmed: false,
          });
        }
        await delay(6500);
      } finally {
        await recorder.stop();
      }
      const { stdout } = await promisify(execFile)(
        ffmpeg!,
        [
          "-xerror",
          "-v",
          "error",
          "-ss",
          "5",
          "-i",
          recording,
          "-frames:v",
          "1",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ],
        {
          encoding: "buffer",
          maxBuffer: 8 * 1024 * 1024,
          timeout: 15000,
          windowsHide: true,
        },
      );
      expect(stdout.length).toBe(1920 * 1080 * 3);
      const left = (540 * 1920 + 480) * 3;
      const right = (540 * 1920 + 1440) * 3;
      const ice = (100 * 1920 + 960) * 3;
      expect(stdout[left]).toBeGreaterThan(180);
      expect(stdout[left + 1]).toBeLessThan(70);
      expect(stdout[right]).toBeLessThan(70);
      expect(stdout[right + 1]).toBeGreaterThan(180);
      expect(stdout[ice]).toBeLessThan(70);
      expect(stdout[ice + 1]).toBeLessThan(70);
      expect(stdout[ice + 2]).toBeGreaterThan(180);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 40000);
  it.skipIf(!streamPlugin)(
    "keeps recording after the managed Node handoff reaches default native denial",
    async () => {
      const directory = await mkdtemp(
        join(tmpdir(), "m4-recorder-stream-denial-"),
      );
      const recording = join(directory, "continued.mkv");
      const recorder = await startM4StudioRecorder({
        executable: executable!,
        runtime: runtime!,
        recording,
        streamPlugin,
      });
      const desktop = new M4DesktopClient(
        "11111111-1111-4111-8111-111111111111",
        "https://pilot.invalid",
      );
      vi.spyOn(desktop, "snapshot").mockReturnValue({
        state: "active",
        authorized: true,
      });
      const release = vi
        .spyOn(desktop, "stop")
        .mockResolvedValue({ state: "stopped", authorized: false });
      const handoff = vi
        .spyOn(desktop, "handoffOutput")
        .mockImplementation(async (_id, receive) => {
          await receive(
            {
              serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
              streamKey: "synthetic_default_denial",
            },
            20000,
          );
          return desktop.snapshot();
        });
      let exited = false;
      void recorder.closed.then(() => {
        exited = true;
      });
      try {
        expect(recorder.stream).toBeDefined();
        await expect(
          recorder.stream!.start(
            desktop,
            "33333333-3333-4333-8333-333333333333",
          ),
        ).rejects.toThrow("m4_program_stream_unavailable");
        expect(handoff).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        expect(recorder.stream!.snapshot()).toMatchObject({
          state: "failed",
          liveConfirmed: false,
        });
        await delay(3500);
        expect(exited).toBe(false);
      } finally {
        await recorder.stop();
      }
      await expect(recorder.closed).resolves.toEqual({ finalized: true });
      // Decode a frame after stream rejection, proving the same recording kept
      // producing media rather than merely leaving its file handle open.
      const { stdout } = await promisify(execFile)(
        ffmpeg!,
        [
          "-xerror",
          "-v",
          "error",
          "-ss",
          "3",
          "-i",
          recording,
          "-frames:v",
          "1",
          "-vf",
          "scale=16:16",
          "-pix_fmt",
          "rgb24",
          "-f",
          "rawvideo",
          "-",
        ],
        {
          encoding: "buffer",
          maxBuffer: 1024 * 1024,
          timeout: 15000,
          windowsHide: true,
        },
      );
      expect(stdout.length).toBe(16 * 16 * 3);
    },
    30000,
  );
  it("records and finalizes a decodable MKV through inherited application shutdown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-recorder-"));
    const recording = join(directory, "recording.mkv");
    const recorder = await startM4StudioRecorder({
      executable: executable!,
      runtime: runtime!,
      recording,
    });
    try {
      await delay(2500);
      const first = (await stat(recording)).size;
      // MKV writes are buffered; allow a cluster flush rather than asserting
      // a disk write on an arbitrary frame boundary.
      const deadline = Date.now() + 6000;
      while ((await stat(recording)).size <= first && Date.now() < deadline)
        await delay(100);
      expect((await stat(recording)).size).toBeGreaterThan(first);
    } finally {
      await recorder.stop();
    }
    await expect(recorder.closed).resolves.toEqual({ finalized: true });
    await recorder.stop();
    await promisify(execFile)(
      ffmpeg!,
      ["-xerror", "-v", "error", "-i", recording, "-f", "null", "-"],
      { timeout: 15000, windowsHide: true },
    );
  }, 30000);
  it("refuses an existing recording without modifying it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-recorder-existing-"));
    const recording = join(directory, "existing.mkv");
    await writeFile(recording, "existing-recording-preserved");
    await expect(
      startM4StudioRecorder({
        executable: executable!,
        runtime: runtime!,
        recording,
      }),
    ).rejects.toThrow("m4_recording_unavailable");
    expect(await readFile(recording, "utf8")).toBe(
      "existing-recording-preserved",
    );
  }, 20000);
  it("finalizes after its Node parent exits without requesting Stop", async () => {
    const directory = await mkdtemp(join(tmpdir(), "m4-recorder-parent-"));
    const recording = join(directory, "parent-exit.mkv");
    const script = `
        const {spawn} = require('node:child_process');
        const [exe,runtime,recording] = process.argv.slice(1);
        const child = spawn(exe,['--parent-pid',String(process.pid),'--runtime',runtime,'--recording',recording], {
          windowsHide:true,stdio:['pipe','pipe','ignore'],
          env:{SystemRoot:process.env.SystemRoot,PATH:runtime+';'+process.env.SystemRoot+'\\\\System32',NODE_ENV:'production'}
        });
        let ready=''; child.stdout.on('data', b=>ready+=b.toString('utf8'));
        child.stdout.on('end',()=>{
          if(ready!=='READY\\n') process.exit(2);
          console.log(child.pid);
          setTimeout(()=>process.exit(0),2500);
        });
        child.on('error',()=>process.exit(3));
        setTimeout(()=>process.exit(4),14000);
      `;
    const { stdout } = await promisify(execFile)(
      process.execPath,
      ["-e", script, executable!, runtime!, recording],
      { timeout: 16000, windowsHide: true },
    );
    const pid = Number(stdout.trim());
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    const alive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const deadline = Date.now() + 10000;
    while (alive() && Date.now() < deadline) await delay(100);
    expect(alive()).toBe(false);
    await promisify(execFile)(
      ffmpeg!,
      ["-xerror", "-v", "error", "-i", recording, "-f", "null", "-"],
      { timeout: 15000, windowsHide: true },
    );
  }, 40000);
});
