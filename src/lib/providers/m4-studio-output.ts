// Called by the managed Studio host after desktop pairing. No browser exports.
import type { Readable } from "node:stream";
import { M4ApplicationOutput } from "./m4-application-output";
import { M4DesktopClient } from "./m4-desktop-client";
import { M4NativePipeClient } from "./m4-native-pipe";
import { readM4StudioBootstrap } from "./m4-studio-bootstrap";
import { M4StudioRuntime } from "./m4-studio-runtime";

/** The trusted native host supplies a private inherited stream, not a file or
 * environment variable. Desktop pairing must precede this one-shot lifetime.
 * This only arms the native service; it does not report YouTube live status. */
export async function runM4StudioOutput(
  desktop: M4DesktopClient,
  intentId: string,
  bootstrapInput: Readable,
  signal: AbortSignal,
) {
  let native: M4NativePipeClient | undefined;
  let capability: Buffer | undefined;
  let runtime: M4StudioRuntime | undefined;
  let failed = false;
  try {
    if (signal.aborted || !desktop.snapshot().authorized) throw new Error();
    const bootstrap = await readM4StudioBootstrap(bootstrapInput);
    capability = bootstrap.capability;
    if (signal.aborted) throw new Error();
    native = await M4NativePipeClient.connect(bootstrap.pipe, capability);
    capability.fill(0);
    runtime = new M4StudioRuntime(new M4ApplicationOutput(desktop, native));
    await runtime.run(intentId, signal);
  } catch {
    failed = true;
  } finally {
    capability?.fill(0);
    try {
      if (runtime) await runtime.stop();
      else await desktop.stop();
    } catch {
      failed = true;
    }
    native?.disconnect();
    if (failed) throw new Error("m4_studio_output_unavailable");
  }
}
