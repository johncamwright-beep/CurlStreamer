// Native validation only. Prebundle before launch; no development loader or secrets in argv.
import { readM4StudioBootstrap } from "../src/lib/providers/m4-studio-bootstrap";
import { M4NativePipeClient } from "../src/lib/providers/m4-native-pipe";

let native: M4NativePipeClient | undefined;
let capability: Buffer | undefined;
try {
  if (
    ["NODE_OPTIONS", "NODE_PATH", "M4_PARENT_ENV_CANARY"].some(
      (key) => process.env[key] !== undefined,
    )
  )
    throw new Error();
  const bootstrap = await readM4StudioBootstrap(process.stdin);
  capability = bootstrap.capability;
  native = await M4NativePipeClient.connect(bootstrap.pipe, capability);
  capability.fill(0);
  let denied = false;
  try {
    await native.arm(
      {
        serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
        streamKey: "synthetic_key_for_default_denial",
      },
      1000,
    );
  } catch {
    denied = native.snapshot().state === "failed";
  }
  if (!denied) throw new Error();
  process.exitCode = 0;
} catch {
  // No raw errors: stack traces can contain runtime module text or credentials.
  process.exitCode = 1;
} finally {
  capability?.fill(0);
  native?.disconnect();
}
