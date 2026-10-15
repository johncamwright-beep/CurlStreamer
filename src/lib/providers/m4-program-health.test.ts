import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createM4RendererHealth,
  startM4ProgramWatchdog,
  type M4RendererHealth,
} from "./m4-program-health";

afterEach(() => vi.useRealTimers());
describe("renderer document health", () => {
  it("requires advancing frames and fences late reports from an earlier document", () => {
    let now = 0;
    const health = createM4RendererHealth(() => now);
    const first = "11111111-1111-4111-8111-111111111111";
    const second = "22222222-2222-4222-8222-222222222222";
    health.begin(first);
    const report = {
      action: "renderer-heartbeat" as const,
      instance: first,
      frames: 4,
      visibility: "visible" as const,
    };
    expect(health.observe(report)).toBe(true);
    now = 9000;
    expect(health.observe(report)).toBe(true);
    expect(health.snapshot()).toMatchObject({
      heartbeatAgeMs: 0,
      frameAgeMs: 9000,
    });
    expect(health.observe({ ...report, frames: 3 })).toBe(false);
    health.begin(second);
    expect(health.observe({ ...report, frames: 100 })).toBe(false);
    expect(health.observe({ ...report, instance: second, frames: 1 })).toBe(
      true,
    );
    health.close();
    expect(health.observe({ ...report, instance: second, frames: 2 })).toBe(
      false,
    );
  });
});

function setup() {
  vi.useFakeTimers();
  let now = 0;
  const renderer: M4RendererHealth = {
    active: true,
    startedMs: 0,
    heartbeatAgeMs: 0,
    frameAgeMs: 0,
    frames: 30,
    visibility: "visible",
  };
  const paint = { rawSequence: 100, paintChanges: 10, ageMs: 0, active: true };
  const refresh = vi.fn().mockResolvedValue(true);
  const diagnostic = vi.fn();
  const getPaint = vi.fn().mockImplementation(async () => ({ ...paint }));
  const watchdog = startM4ProgramWatchdog({
    renderer: () => ({ ...renderer, startedMs: now }),
    paint: getPaint,
    refresh,
    diagnostic,
    now: () => now,
  });
  const advance = async (ms: number) => {
    now += ms;
    await vi.advanceTimersByTimeAsync(ms);
  };
  return { renderer, paint, refresh, diagnostic, getPaint, watchdog, advance };
}

describe("bounded program recovery", () => {
  it("does not reload healthy output or advancing hidden output", async () => {
    const s = setup();
    try {
      s.renderer.visibility = "hidden";
      await s.advance(25000);
      expect(s.watchdog.snapshot().phase).toBe("healthy");
      expect(s.refresh).not.toHaveBeenCalled();
    } finally {
      s.watchdog.close();
    }
  });
  it("detects frozen compositor paint even with fresh browser heartbeat and raw output callbacks", async () => {
    const s = setup();
    try {
      s.paint.ageMs = 25000;
      await s.advance(21000);
      expect(s.refresh).toHaveBeenCalledTimes(1);
      expect(s.diagnostic).toHaveBeenCalledWith(
        expect.objectContaining({ code: "paint_stale" }),
      );
      expect(s.watchdog.snapshot().phase).toBe("recovering");
      s.paint.ageMs = 0;
      await s.advance(1500);
      expect(s.watchdog.snapshot().phase).toBe("healthy");
      expect(s.diagnostic).toHaveBeenCalledWith(
        expect.objectContaining({ code: "recovered" }),
      );
    } finally {
      s.watchdog.close();
    }
  });
  it("allows startup then attempts at most three refreshes per ten minutes; acceptance does not prove recovery", async () => {
    const s = setup();
    try {
      s.renderer.heartbeatAgeMs = null;
      await s.advance(19000);
      expect(s.refresh).not.toHaveBeenCalled();
      await s.advance(2000);
      expect(s.refresh).toHaveBeenCalledTimes(1);
      await s.advance(16000);
      await s.advance(16000);
      await s.advance(16000);
      expect(s.refresh).toHaveBeenCalledTimes(3);
      expect(s.watchdog.snapshot().phase).toBe("failed");
      await s.advance(16000);
      expect(s.refresh).toHaveBeenCalledTimes(3);
      expect(
        s.diagnostic.mock.calls.filter(
          ([event]) => event.code === "recovery_exhausted",
        ),
      ).toHaveLength(1);
    } finally {
      s.watchdog.close();
    }
  });
  it("serializes native queries and ignores a late result after shutdown", async () => {
    const s = setup();
    let finish!: (value: typeof s.paint) => void;
    s.getPaint.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    s.renderer.frameAgeMs = 20000;
    await s.advance(25000);
    expect(s.getPaint).toHaveBeenCalledTimes(1);
    s.watchdog.close();
    finish(s.paint);
    await vi.advanceTimersByTimeAsync(10000);
    expect(s.refresh).not.toHaveBeenCalled();
    expect(s.getPaint).toHaveBeenCalledTimes(1);
  });
});
