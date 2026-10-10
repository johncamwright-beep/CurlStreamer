// Called only by the native validation launcher. No credential arguments/files.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
let client;
let bootstrap;
let token;
try {
  if (
    ["NODE_OPTIONS", "NODE_PATH", "M4_PARENT_ENV_CANARY"].some(
      (name) => process.env[name] !== undefined,
    )
  )
    throw new Error("invalid child environment");
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 384) throw new Error("invalid bootstrap");
    chunks.push(chunk);
  }
  bootstrap = Buffer.concat(chunks);
  for (const chunk of chunks) chunk.fill(0);
  if (bootstrap.length !== 384) throw new Error("invalid bootstrap");
  const pipe = bootstrap
    .subarray(0, 256)
    .toString("utf16le")
    .replace(/\0.*$/s, "");
  token = Buffer.from(bootstrap.subarray(256, 288));
  const key = bootstrap
    .subarray(288, 368)
    .toString("ascii")
    .replace(/\0.*$/s, "");
  const scenario = bootstrap.readUInt32LE(368);
  bootstrap.fill(0);
  const built = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/lib/providers/m4-native-pipe.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { M4NativePipeClient } = await import(
    `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].contents).toString("base64")}`
  );
  client = await M4NativePipeClient.connect(pipe, token, { synthetic: true });
  token.fill(0);
  await client.arm(
    { serverUrl: "rtmps://synthetic.invalid/live2", streamKey: key },
    1000,
  );
  await new Promise((resolve) => setTimeout(resolve, 200));
  if (scenario === 1) client.disconnect();
  else if (scenario === 3) await client.renew(1800);
  else if (scenario === 4) await client.stop();
  else if (scenario !== 0 && scenario !== 2)
    throw new Error("unsupported proof scenario");
  await new Promise((resolve) => setTimeout(resolve, 3000));
} catch {
  process.exitCode = 1; // Native host reports only safe assertions.
} finally {
  bootstrap?.fill(0);
  token?.fill(0);
  client?.disconnect();
}
