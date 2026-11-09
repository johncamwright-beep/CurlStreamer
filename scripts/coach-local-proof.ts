import { randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { startCoachLocalProof } from "../src/lib/providers/coach-local-proof";
const [host, video, output] = process.argv.slice(2);
if (!host || !video || !output)
  throw Error(
    "Usage: coach-local-proof.ts <LAN IP> <two-minute MP4> <local status file>",
  );
const code = String(randomInt(100000, 1000000));
const proof = await startCoachLocalProof({
  host,
  port: 3188,
  video,
  code,
  duration: 120,
});
await writeFile(
  output,
  JSON.stringify({
    address: proof.address,
    pairingCode: code,
    pid: process.pid,
    expiresAt: new Date(Date.now() + 7200000).toISOString(),
  }),
);
const report = setInterval(
  () => void writeFile(output + ".stats", JSON.stringify(proof.stats())),
  2000,
);
report.unref();
process.on("SIGTERM", () => {
  proof.close();
  process.exit();
});
