import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createM4OperatorServer } from "../src/lib/providers/m4-operator-server";
import { createStudioConnectionDiagnostics } from "../src/lib/providers/connection-diagnostics-node";
import {
  createStudioDiagnostics,
  studioFailureCode,
  type StudioDiagnostic,
} from "../src/lib/providers/m5-studio-diagnostics";
import {
  readStudioGame,
  readStudioInstallation,
  studioFiles,
} from "../src/lib/providers/m5-studio-installation";

// Only a game page URL crosses the command line. Invitations stay in operator memory.
let operator: Awaited<ReturnType<typeof createM4OperatorServer>> | undefined;
let closing: Promise<void> | undefined;
let requestedClose = false;
let diagnostic: StudioDiagnostic = () => undefined;
// Observe fatal failures without suppressing Node's normal termination. Raw
// exceptions stay out of the lifecycle journal and launcher protocol.
process.on("uncaughtExceptionMonitor", (cause, origin) => {
  diagnostic(
    origin === "unhandledRejection" ? "fatal_rejection" : "fatal_exception",
    { failure: studioFailureCode(cause) },
  );
});
const input = createInterface({ input: process.stdin, terminal: false });
const close = (
  reason:
    "operator_close" | "stdin_closed" | "sigint" | "sigterm" | "startup_failed",
) => {
  if (!requestedClose) diagnostic("shutdown_requested", { reason });
  requestedClose = true;
  if (!operator) return;
  closing ??= (async () => {
    const outcome = await operator!.close();
    diagnostic(
      outcome.cleanupConfirmed ? "shutdown_confirmed" : "shutdown_unconfirmed",
    );
    process.stdout.write(
      outcome.cleanupConfirmed ? "CLOSED\n" : "CLEANUP_UNCONFIRMED\n",
    );
    if (!outcome.cleanupConfirmed) process.exitCode = 2;
    input.close();
    process.stdin.destroy();
  })();
};
input.on("line", (line) => {
  if (line === "close") close("operator_close");
});
input.on("close", () => close("stdin_closed"));
process.once("SIGINT", () => close("sigint"));
process.once("SIGTERM", () => close("sigterm"));
try {
  if (
    process.platform !== "win32" ||
    process.argv.length !== 3 ||
    !process.env.LOCALAPPDATA
  )
    throw new Error();
  const { root, configuration, manifest } = await readStudioInstallation(
    dirname(dirname(fileURLToPath(import.meta.url))),
  );
  if (process.version !== manifest.nodeVersion) throw new Error();
  const gameId = readStudioGame(process.argv[2], configuration.website);
  const requestedDataRoot = join(
    process.env.LOCALAPPDATA,
    "CurlStreamer",
    "Studio",
  );
  await mkdir(requestedDataRoot, { recursive: true });
  // Windows can virtualize LocalAppData for a launcher inherited from an MSIX
  // app. Pass its canonical location to native children and cache recovery so
  // they agree on the same directory, without relaxing cache link checks.
  const dataRoot = await realpath(requestedDataRoot);
  diagnostic = createStudioDiagnostics(dataRoot);
  diagnostic("controller_start");
  const recordingRoot = join(dataRoot, "Recordings");
  await mkdir(recordingRoot, { recursive: true });
  if (requestedClose) {
    process.stdout.write("CLOSED\n");
    input.close();
    process.stdin.destroy();
  } else {
    const runtime = join(root, "obs", "bin", "64bit");
    operator = await createM4OperatorServer({
      origin: configuration.website,
      gameId,
      diagnostic,
      connectionDiagnostic: createStudioConnectionDiagnostics(dataRoot),
      paths: {
        executable: join(root, studioFiles.host),
        plugin: join(root, studioFiles.defaultPlugin),
        runtime,
      },
      ipCamera: {
        helperPath: join(root, studioFiles.ipCamera),
        runtimePath: runtime,
      },
      pairingEnabled: configuration.streamingEnabled,
      streamingEnabled: configuration.streamingEnabled,
      program: {
        realtimeUrl: configuration.realtimeUrl,
        realtimeKey: configuration.realtimeKey,
        recorder: join(root, studioFiles.recorder),
        runtime,
        recordingRoot,
        cacheRoot: join(dataRoot, "Cache"),
        rendererRoot: join(root, "renderer"),
        ...(configuration.streamingEnabled
          ? { streamPlugin: join(root, studioFiles.streamPlugin) }
          : {}),
      },
    });
    if (requestedClose) close("operator_close");
    else {
      diagnostic("controller_ready");
      process.stdout.write(`READY ${operator.address}\n`);
    }
  }
} catch {
  diagnostic("start_failed");
  process.stdout.write("START_FAILED\n");
  process.exitCode = 1;
  if (operator) close("startup_failed");
  else {
    input.close();
    process.stdin.destroy();
  }
}
