import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EnduranceRecorder,
  enduranceStorageKey,
} from "./m2-endurance-recorder";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());
it("records portrait dimensions and completes only at the 2.5-hour deadline", async () => {
  let saved = "";
  const finished = vi.fn();
  const run = new EnduranceRecorder({
    save: (value) => {
      saved = value;
    },
    finished,
    metrics: () => undefined,
    context: () => ({
      metricsAt: Date.now() - 100,
      frameWidth: 720,
      frameHeight: 1280,
      online: true,
      visibility: "visible",
    }),
  });
  run.report.cameraRole = "camera-home";
  run.start();
  await vi.advanceTimersByTimeAsync(7_200_000);
  expect(finished).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1_799_000);
  expect(finished).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(finished).toHaveBeenCalledExactlyOnceWith("completed");
  expect(run.report.endedAt! - run.report.startedAt).toBe(9_000_000);
  const report = JSON.parse(saved);
  expect(report).toMatchObject({
    milestone: "M2",
    cameraRole: "camera-home",
    outcome: "completed",
    persistence: "ok",
  });
  expect(report.checkpoints).toHaveLength(601);
  expect(
    report.checkpoints.every(
      (sample: { frameWidth: number; frameHeight: number }) =>
        sample.frameWidth === 720 && sample.frameHeight === 1280,
    ),
  ).toBe(true);
  run.finish("interrupted", "late cleanup");
  expect(finished).toHaveBeenCalledTimes(1);
});
it("keeps separate role records and advances the second timer after the first fails", async () => {
  const storage = new Map<string, string>();
  const make = (role: "camera-home" | "camera-away") => {
    const finished = vi.fn();
    const key = enduranceStorageKey(`game:${role}`);
    const run = new EnduranceRecorder({
      save: (value) => {
        storage.set(key, value);
      },
      metrics: () => undefined,
      finished,
    });
    run.report.cameraRole = role;
    return { run, key, finished };
  };
  const home = make("camera-home"),
    away = make("camera-away");
  home.run.start();
  away.run.start();
  await vi.advanceTimersByTimeAsync(15_000);
  home.run.finish("interrupted", "Camera 1 disconnected");
  const stoppedHome = storage.get(home.key);
  const previous = away.run.report.checkpoints.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(home.key).not.toBe(away.key);
  expect(home.key).toContain("curlcast-m2-endurance:");
  expect(storage.get(home.key)).toBe(stoppedHome);
  expect(away.run.report.checkpoints.length).toBeGreaterThan(previous);
  expect(away.finished).not.toHaveBeenCalled();
  expect(JSON.parse(storage.get(away.key)!)).toMatchObject({
    cameraRole: "camera-away",
    outcome: "running",
  });
  away.run.finish("interrupted", "Operator stopped");
});
it("does not count a suspended browser as a successful 2.5-hour run", async () => {
  const finished = vi.fn();
  const run = new EnduranceRecorder({
    save: vi.fn(),
    metrics: () => undefined,
    finished,
  });
  run.start();
  vi.setSystemTime(Date.now() + 9_000_000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(finished).toHaveBeenCalledExactlyOnceWith("interrupted");
  expect(run.report.reason).toContain("suspended");
});
