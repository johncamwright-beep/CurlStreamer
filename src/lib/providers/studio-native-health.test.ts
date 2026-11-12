import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, expect } from "vitest";
import { nativeHealthReader } from "./studio-native-health";
it("reads bounded, fresh local telemetry and tolerates missing/invalid/stale files", () => {
  const dir = mkdtempSync(join(tmpdir(), "studio-health-"));
  let now = 20000;
  const read = nativeHealthReader(dir, () => now);
  try {
    expect(read()).toBeNull();
    const sample = {
      capturedAt: 22000,
      targetKbps: 6000,
      sentKbps: 4000,
      congestion: 0.2,
      droppedFrames: 2,
      totalFrames: 60,
      adaptiveBitrate: true,
      renderFps: 30,
      renderMs: 2,
      renderSkippedFrames: 0,
      secret: "no",
    };
    writeFileSync(join(dir, "studio-health.json"), JSON.stringify(sample));
    now = 22000;
    expect(read()?.sentKbps).toBe(4000);
    expect(read()).not.toHaveProperty("secret");
    writeFileSync(join(dir, "studio-health.json"), "invalid");
    now = 23000;
    expect(read()?.sentKbps).toBe(4000);
    now = 24000;
    expect(read()).toBeNull();
    writeFileSync(join(dir, "studio-health.json"), JSON.stringify(sample));
    now = 40000;
    expect(read()).toBeNull();
    writeFileSync(join(dir, "studio-health.json"), " ".repeat(4097));
    now = 42000;
    expect(read()).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
