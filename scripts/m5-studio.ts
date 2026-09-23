import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, realpath } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createM4OperatorServer } from "../src/lib/providers/m4-operator-server";
import {
  readStudioGame,
  readStudioInstallation,
  studioFiles,
} from "../src/lib/providers/m5-studio-installation";

// Only a game page URL crosses the command line. Invitations stay in operator memory.
let operator: Awaited<ReturnType<typeof createM4OperatorServer>> | undefined;
let closing: Promise<void> | undefined;
let requestedClose = false;
const input = createInterface({ input: process.stdin, terminal: false });
const close = () => {
  requestedClose = true;
  if (!operator) return;
  closing ??= (async () => {
    const outcome = await operator!.close();
    process.stdout.write(
      outcome.cleanupConfirmed ? "CLOSED\n" : "CLEANUP_UNCONFIRMED\n",
    );
    if (!outcome.cleanupConfirmed) process.exitCode = 2;
    input.close();
    process.stdin.destroy();
  })();
};
input.on("line", (line) => {
  if (line === "close") close();
});
input.on("close", close);
process.once("SIGINT", close);
process.once("SIGTERM", close);
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
      paths: {
        executable: join(root, studioFiles.host),
        plugin: join(root, studioFiles.defaultPlugin),
        runtime,
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
    if (requestedClose) close();
    else process.stdout.write(`READY ${operator.address}\n`);
  }
} catch {
  process.stdout.write("START_FAILED\n");
  process.exitCode = 1;
  if (operator) close();
  else {
    input.close();
    process.stdin.destroy();
  }
}
