import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const folder = new URL("./assets/", import.meta.url);
await mkdir(folder, { recursive: true });
await copyFile(
  new URL(
    "../../node_modules/livekit-client/dist/livekit-client.umd.js",
    import.meta.url,
  ),
  new URL("livekit-client.umd.js", folder),
);
const response = await fetch(
  "https://cdn.jsdelivr.net/npm/hls.js@1.7.2/dist/hls.min.js",
);
if (!response.ok) throw new Error("Pinned HLS player download failed");
await writeFile(
  new URL("hls.min.js", folder),
  Buffer.from(await response.arrayBuffer()),
);
console.log(`Prepared browser assets in ${fileURLToPath(folder)}`);
