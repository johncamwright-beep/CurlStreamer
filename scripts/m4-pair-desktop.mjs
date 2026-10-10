// Interactive authority proof only. Does not configure OBS or start output.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";

const [origin, gameId, ...extra] = process.argv.slice(2);
const usage =
  "Usage: node scripts/m4-pair-desktop.mjs <HTTPS app origin> <game UUID>";
if (origin === "--help" && !gameId) {
  console.log(usage);
  console.log(
    "Pairs this terminal session only. No OBS or YouTube output is started. Paste the approval code at the hidden prompt; never pass credentials as arguments.",
  );
  process.exit(0);
}
if (!origin || !gameId || extra.length || !process.stdin.isTTY) {
  console.error(usage + " (interactive terminal required)");
  process.exit(1);
}

let client;
let closing = false;
let wake;
let prompt;
function pause(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      wake = undefined;
      resolve();
    }, ms);
    wake = () => {
      clearTimeout(timer);
      wake = undefined;
      resolve();
    };
  });
}
function requestStop() {
  closing = true;
  prompt?.close();
  wake?.();
}
process.once("SIGINT", requestStop);
process.once("SIGTERM", requestStop);

try {
  const compiled = await build({
    entryPoints: [
      fileURLToPath(
        new URL("../src/lib/providers/m4-desktop-client.ts", import.meta.url),
      ),
    ],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const { M4DesktopClient } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].contents).toString("base64")}`
  );
  client = new M4DesktopClient(gameId, origin);
  console.log(
    "Desktop pairing proof — streaming is unavailable in this helper.",
  );
  console.log(
    `Approval page: ${new URL(`/studio-m4/${gameId}/pairing`, origin).href}`,
  );
  console.log(`Desktop challenge: ${client.challenge}`);
  console.log(
    "Open that page in your signed-in browser, paste the challenge and approve this desktop.",
  );
  process.stdout.write(
    "Paste the approval code here (hidden), then press Enter: ",
  );
  const muted = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  prompt = createInterface({
    input: process.stdin,
    output: muted,
    terminal: true,
    historySize: 0,
  });
  prompt.once("SIGINT", requestStop);
  let approval = await new Promise((resolve, reject) => {
    prompt.question("", resolve);
    prompt.once("close", () => reject(new Error("pairing_cancelled")));
  });
  prompt.close();
  prompt = undefined;
  process.stdout.write("\n");
  if (closing) throw new Error("pairing_cancelled");
  try {
    await client.exchange(String(approval).trim());
  } finally {
    approval = undefined;
  }
  if (!closing)
    console.log(
      "Desktop authority paired. No output is running. Press Ctrl+C to release it.",
    );
  while (!closing) {
    await pause(5_000);
    if (closing) break;
    const result = await client.heartbeat();
    if (!result.authorized || result.desiredAction === "stop") break;
  }
} catch {
  // Do not print exceptions, HTTP bodies, secrets, or compiled module data URLs.
  console.error(
    closing
      ? "Pairing cancelled."
      : "Desktop pairing or heartbeat failed. No output was started by this helper.",
  );
  process.exitCode = closing ? 0 : 1;
} finally {
  prompt?.close();
  if (client && client.snapshot().state !== "unpaired") {
    try {
      const result = await client.stop();
      console.log(
        result.state === "stopped"
          ? "Desktop authority release confirmed."
          : "Desktop authority release remains unconfirmed.",
      );
    } catch {
      console.error(
        "Desktop release is unconfirmed; allow its lease to expire before pairing again.",
      );
      process.exitCode = 1;
    }
  }
}
