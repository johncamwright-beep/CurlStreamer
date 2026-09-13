import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EnduranceRecorder } from "./endurance-recorder";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());
it("saves checkpoints and finishes once at the two-hour deadline", async () => {
  const save = vi.fn(),
    finished = vi.fn();
  const run = new EnduranceRecorder({
    save,
    finished,
    metrics: () => undefined,
  });
  run.start();
  await vi.advanceTimersByTimeAsync(7_199_000);
  expect(finished).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(finished).toHaveBeenCalledExactlyOnceWith("completed");
  expect(run.report.checkpoints).toHaveLength(481);
  expect(JSON.parse(save.mock.lastCall![0]).outcome).toBe("completed");
  run.finish("interrupted", "late stop");
  expect(finished).toHaveBeenCalledTimes(1);
});
it("records early failures and stops further checkpoints", async () => {
  const save = vi.fn(),
    finished = vi.fn();
  const run = new EnduranceRecorder({
    save,
    finished,
    metrics: () => undefined,
  });
  run.start();
  await vi.advanceTimersByTimeAsync(15_000);
  run.finish("interrupted", "Connection ended");
  const count = save.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30_000);
  expect(save).toHaveBeenCalledTimes(count);
  expect(run.report.reason).toBe("Connection ended");
});
it("does not count sleep as a completed endurance run", async () => {
  const finished = vi.fn();
  const run = new EnduranceRecorder({
    save: vi.fn(),
    finished,
    metrics: () => undefined,
  });
  run.start();
  vi.setSystemTime(Date.now() + 8_000_000);
  await vi.advanceTimersByTimeAsync(1000);
  expect(finished).toHaveBeenCalledWith("interrupted");
});
it("preserves exact failure reason and the age of the last metrics", () => {
  const save = vi.fn();
  const run = new EnduranceRecorder({
    save,
    finished: vi.fn(),
    metrics: () => undefined,
    context: () => ({
      metricsAt: 990_000,
      visibility: "visible",
      online: true,
    }),
  });
  run.start();
  run.finish("interrupted", "Studio check request failed (HTTP 502).");
  run.finish("interrupted", "generic cleanup");
  const report = JSON.parse(save.mock.lastCall![0]);
  expect(report.reason).toBe("Studio check request failed (HTTP 502).");
  expect(report.checkpoints.at(-1)).toMatchObject({
    at: 1_000_000,
    metricsAt: 990_000,
    visibility: "visible",
    online: true,
  });
});
it("retains the original failure in memory when the final storage write fails", () => {
  const save = vi.fn();
  const finished = vi.fn();
  const run = new EnduranceRecorder({
    save,
    finished,
    metrics: () => undefined,
  });
  run.start();
  save.mockImplementation(() => {
    throw Error("quota");
  });
  run.finish("interrupted", "Private signaling disconnected.");
  expect(run.report).toMatchObject({
    outcome: "failed",
    persistence: "final-write-failed",
    reason: "Private signaling disconnected.",
  });
  expect(finished).toHaveBeenCalledWith("failed");
});
