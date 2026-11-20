import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const [command, argument, ...extra] = process.argv.slice(2);
if (
  !["status", "prepare", "preview", "start", "stop"].includes(command) ||
  extra.length ||
  (command === "status" && argument) ||
  (["prepare", "preview", "start", "stop"].includes(command) && !argument)
) {
  console.error(
    "Usage: node scripts/m3-obs.mjs status | prepare <private-url-file or -> | preview <scene-name> | start <scene-name> | stop <scene-name>",
  );
  process.exit(1);
}
let client;
try {
  const result = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/lib/providers/obs-local.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { ObsLocal } = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
  client = new ObsLocal();
  const password = process.env.OBS_WEBSOCKET_PASSWORD;
  delete process.env.OBS_WEBSOCKET_PASSWORD;
  await client.connect(
    process.env.OBS_WEBSOCKET_URL || "ws://127.0.0.1:4455",
    password || "",
  );
  let output;
  if (command === "status") output = await client.inspect();
  if (command === "prepare") {
    let value;
    if (argument === "-") {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of process.stdin) {
        bytes += chunk.length;
        if (bytes > 8192) throw new Error("Input too long");
        chunks.push(chunk);
      }
      value = Buffer.concat(chunks).toString("utf8");
    } else {
      if (/^https?:/i.test(argument))
        throw new Error(
          "Pass a private file path, never the program URL on the command line",
        );
      value = await readFile(argument, "utf8");
      if (value.length > 8192) throw new Error("Input too long");
    }
    output = await client.prepare(value);
  }
  if (command === "preview") output = await client.preview(argument);
  if (command === "start") output = await client.start(argument);
  if (command === "stop") output = await client.stop(argument);
  console.log(JSON.stringify(output, null, 2));
} catch (error) {
  // Parse errors can embed the secret input. Only emit our fixed, safe messages.
  const message = error instanceof Error ? error.message : "";
  const safe =
    /^(OBS |Select the dedicated |Configure OBS |Configure 1080p30 |M3 scene identity mismatch|Active scene differs; stop manually in OBS|Expected a private M3 HTTPS program invitation|Pass a private file path|Input too long)/;
  console.error(
    safe.test(message)
      ? message
      : "M3 OBS command failed; check local setup and private input",
  );
  process.exitCode = 1;
} finally {
  client?.close();
}
