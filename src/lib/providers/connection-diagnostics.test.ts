import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  connectionFailureReason,
  createConnectionDiagnostics,
} from "./connection-diagnostics";
import { createStudioConnectionDiagnostics } from "./connection-diagnostics-node";
const run = "11111111-1111-4111-8111-111111111111";
afterEach(() => vi.useRealTimers());
describe("connection diagnostics privacy and bounded evidence", () => {
  it("rejects arbitrary secrets and bad values instead of serializing them", () => {
    const persist = vi.fn();
    const log = createConnectionDiagnostics("studio", run, persist);
    log.record({ layer: "http", code: "timeout", token: "secret" } as never);
    log.record({ layer: "http", code: "rtmp://private" } as never);
    log.record({ layer: "media", code: "sample", frames: Infinity });
    expect(persist).not.toHaveBeenCalled();
    log.record({
      layer: "http",
      code: "timeout",
      action: "check",
      role: "camera-away",
      trace: run,
      durationMs: 8000,
    });
    expect(log.snapshot()).toHaveLength(1);
    expect(JSON.stringify(log.snapshot())).not.toContain("secret");
    const copied = log.snapshot();
    copied[0].code = "ready";
    expect(log.snapshot()[0].code).toBe("timeout");
  });
  it("coalesces repeated failures and bounds durable history across restarts", () => {
    vi.useFakeTimers();
    const log = createConnectionDiagnostics("phone", run, () => undefined);
    log.record({ layer: "session", code: "retry" });
    vi.advanceTimersByTime(1000);
    log.record({ layer: "session", code: "retry" });
    expect(log.snapshot()[0].count).toBe(2);
    for (let attempt = 0; attempt < 550; attempt++)
      log.record({ layer: "capture", code: "started", attempt });
    expect(log.snapshot()).toHaveLength(512);
    const restarted = createConnectionDiagnostics(
      "phone",
      run,
      () => {
        throw Error("disk full");
      },
      log.snapshot(),
    );
    expect(() =>
      restarted.record({ layer: "wake", code: "wake_unavailable" }),
    ).not.toThrow();
    expect(restarted.snapshot()).toHaveLength(512);
    expect(
      createConnectionDiagnostics("phone", run, () => undefined, [
        { token: "secret" },
      ]).snapshot(),
    ).toEqual([]);
  });
  it("keeps Studio evidence in a separate journal without raw exception content", () => {
    const directory = mkdtempSync(join(tmpdir(), "connection-journal-"));
    try {
      createStudioConnectionDiagnostics(directory)({
        layer: "realtime",
        code: "channel_closed",
        role: "camera-home",
      });
      createStudioConnectionDiagnostics(directory)({
        layer: "session",
        code: "recovered",
      });
      expect(
        JSON.parse(
          readFileSync(join(directory, "connection-diagnostics.json"), "utf8"),
        ),
      ).toHaveLength(2);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it.each([
    ["Studio authority expired. secret", "lease_expired"],
    ["Direct path verification timed out. private-IP", "verification_timeout"],
    ["Private signaling disconnected. token", "channel_closed"],
    ["WebRTC transport failed. private", "transport_failed"],
    ["rtmp-key=secret", "unknown_failure"],
  ])("reduces an internal reason to a fixed safe code", (reason, expected) =>
    expect(connectionFailureReason(reason)).toBe(expected),
  );
});
