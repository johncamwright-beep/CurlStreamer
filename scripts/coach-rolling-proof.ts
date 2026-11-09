import { randomInt } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { startNativeCoachProof } from "../native/m4-studio-recorder/coach-proof-host.mjs";
import { startCoachLocalProof } from "../src/lib/providers/coach-local-proof";

const [host, runtime, output] = process.argv.slice(2);
if (!host || !runtime || !output)
  throw Error(
    "Usage: coach-rolling-proof.ts <LAN IP> <OBS runtime> <status file>",
  );
const native = await startNativeCoachProof(
  "work/coach-native-build/Release/m4_studio_recorder.exe",
  runtime,
  "work/ffmpeg/ffmpeg.exe",
  "work/coach-rolling-evidence",
);
const code =
  process.env.COACH_PROOF_PAIR_CODE ?? String(randomInt(100000, 1000000));
try {
  const proof = await startCoachLocalProof({
    host,
    port: 3189,
    code,
    duration: 120,
    capture: native.capture,
  });
  await writeFile(
    output,
    JSON.stringify({
      address: proof.address,
      pairingCode: code,
      pid: process.pid,
      evidence: native.evidence,
    }),
  );
  const report = setInterval(
    () => void writeFile(output + ".stats", JSON.stringify(proof.stats())),
    2000,
  );
  const close = () => {
    clearInterval(report);
    proof.close();
    native.close();
  };
  setTimeout(close, 7200000).unref();
  process.on("SIGTERM", close);
} catch (error) {
  native.close();
  throw error;
}
