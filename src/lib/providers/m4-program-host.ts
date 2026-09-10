// Node-only owner for the private renderer, direct cameras and isolated recorder.
import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { M4ProgramClient } from "./m4-program-client";
import { createM4ProgramRealtime } from "./m4-program-realtime";
import { createM4ProgramBridge } from "./m4-program-bridge";
import { startM4StudioRecorder } from "./m4-studio-recorder";
import { recoverM4ProgramCaches } from "./m4-program-cache";

const optionsSchema = z
  .object({
    gameId: z.uuid(),
    origin: z.url().refine((value) => new URL(value).origin === value),
    invitation: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    realtimeUrl: z.url().refine((value) => {
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value;
    }),
    realtimeKey: z.string().min(1).max(16384),
    executable: z.string().min(1),
    runtime: z.string().min(1),
    recording: z.string().min(1),
    previewOnly: z.boolean().optional(),
    cacheRoot: z.string().min(1),
    rendererRoot: z.string().min(1),
    streamPlugin: z.string().min(1).optional(),
  })
  .strict();

/** Starts one complete local program lifetime. Credentials stay in this Node
 * process; the recorder receives only an uncredentialed loopback root URL.
 * The per-run CEF cache is deleted after the native child has exited.
 */
export async function startM4ProgramHost(input: z.input<typeof optionsSchema>) {
  const options = optionsSchema.parse(input);
  const cacheRoot = resolve(options.cacheRoot);
  const rendererRoot = resolve(options.rendererRoot);
  if (
    process.platform !== "win32" ||
    !isAbsolute(cacheRoot) ||
    !isAbsolute(rendererRoot) ||
    !/^[A-Za-z]:[\\/]/.test(cacheRoot) ||
    !/^[A-Za-z]:[\\/]/.test(rendererRoot) ||
    cacheRoot.includes("\0") ||
    rendererRoot.includes("\0") ||
    dirname(cacheRoot) === cacheRoot
  )
    throw new Error("m4_program_host_unavailable");
  await mkdir(cacheRoot, { recursive: true });
  await recoverM4ProgramCaches(cacheRoot);
  const cacheDirectory = join(
    cacheRoot,
    `curlstreamer-m4-cef-${randomBytes(16).toString("hex")}`,
  );
  const safeCache =
    dirname(resolve(cacheDirectory)) === cacheRoot &&
    /^curlstreamer-m4-cef-[a-f0-9]{32}$/.test(basename(cacheDirectory));
  if (!safeCache) throw new Error("m4_program_host_unavailable");

  const client = new M4ProgramClient(options.gameId, options.origin);
  let realtime: ReturnType<typeof createM4ProgramRealtime> | undefined;
  let bridge: Awaited<ReturnType<typeof createM4ProgramBridge>> | undefined;
  let recorder: Awaited<ReturnType<typeof startM4StudioRecorder>> | undefined;
  const eraseCache = () =>
    safeCache
      ? rm(cacheDirectory, { recursive: true, force: true, maxRetries: 3 })
      : Promise.reject(new Error("m4_program_host_unavailable"));
  try {
    await client.exchange(options.invitation);
    realtime = createM4ProgramRealtime({
      client,
      url: options.realtimeUrl,
      key: options.realtimeKey,
    });
    bridge = await createM4ProgramBridge(client, realtime, {
      directory: rendererRoot,
      sponsorStorageOrigin: options.realtimeUrl,
      sponsorCacheDirectory: join(cacheRoot, "SponsorAssets"),
    });
    recorder = await startM4StudioRecorder({
      executable: options.executable,
      runtime: options.runtime,
      recording: options.recording,
      previewOnly: options.previewOnly,
      program: { url: bridge.rendererUrl, cacheDirectory },
      streamPlugin: options.streamPlugin,
    });
  } catch {
    await bridge?.close().catch(() => undefined);
    await realtime?.close().catch(() => undefined);
    client.close();
    // Startup can fail after a child was launched and could not be terminated.
    // Retain its private cache until exit can be established; never remove a
    // directory that CEF may still be using.
    throw new Error("m4_program_host_unavailable");
  }

  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= (async () => {
      let failed = false;
      try {
        await recorder.stop();
      } catch {
        failed = true;
      }
      await bridge.close().catch(() => {
        failed = true;
      });
      if (failed) throw new Error("m4_program_host_unavailable");
      await closed;
    })());
  const closed = recorder.closed.then(async (result) => {
    await bridge.close().catch(() => undefined);
    await eraseCache().catch(() => undefined);
    return result;
  });
  return {
    stop,
    closed,
    rendererAddress: bridge.address,
    cameraStatus: bridge.cameraStatus,
    audioStatus: bridge.audioStatus,
    pushUsbAudio: bridge.pushUsbAudio,
    previewMapping:
      "Local\\CurlStreamerPreview-" + basename(cacheDirectory).slice(20),
    ...(recorder.stream ? { stream: recorder.stream } : {}),
  };
}
