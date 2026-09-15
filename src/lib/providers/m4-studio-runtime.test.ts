import { afterEach, describe, expect, it, vi } from "vitest";
import { M4StudioRuntime } from "./m4-studio-runtime";

const snapshot = () => ({
  desktop: { state: "active" as const, authorized: true },
  native: { state: "armed" as const, deliveryAttempted: true },
});
function fixture() {
  const output = {
    start: vi.fn(async () => snapshot()),
    heartbeat: vi.fn(async () => snapshot()),
    stop: vi.fn(async () => snapshot()),
    snapshot,
  };
  return {
    output,
    runtime: new M4StudioRuntime(output),
    abort: new AbortController(),
  };
}
afterEach(() => vi.useRealTimers());
describe("Studio output lifetime", () => {
  it("does not renew before startup or overlap a slow renewal", async () => {
    vi.useFakeTimers();
    const { output, runtime, abort } = fixture();
    let finish!: (value: ReturnType<typeof snapshot>) => void;
    output.start.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const run = runtime.run("intent", abort.signal);
    await vi.advanceTimersByTimeAsync(15000);
    expect(output.heartbeat).not.toHaveBeenCalled();
    finish(snapshot());
    await vi.advanceTimersByTimeAsync(0);
    output.heartbeat.mockImplementationOnce(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(25000);
    expect(output.heartbeat).toHaveBeenCalledTimes(1);
    abort.abort();
    expect(output.stop).toHaveBeenCalledTimes(1);
    finish(snapshot());
    await run;
    await vi.advanceTimersByTimeAsync(15000);
    expect(output.heartbeat).toHaveBeenCalledTimes(1);
    await expect(runtime.run("intent", abort.signal)).rejects.toThrow(
      "m4_studio_runtime_unavailable",
    );
  });
  it("cleans up once after rejected renewal and hides the underlying error", async () => {
    vi.useFakeTimers();
    const { output, runtime, abort } = fixture();
    output.heartbeat.mockRejectedValueOnce(new Error("private-target"));
    const result = runtime.run("intent", abort.signal);
    const check = expect(result).rejects.toThrow(
      "m4_studio_runtime_unavailable",
    );
    await vi.advanceTimersByTimeAsync(5000);
    await check;
    expect(output.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never arms a cancelled launch and surfaces unconfirmed cleanup", async () => {
    const { output, runtime, abort } = fixture();
    abort.abort();
    output.stop.mockRejectedValueOnce(new Error("private-target"));
    await expect(runtime.run("intent", abort.signal)).rejects.toThrow(
      "m4_studio_runtime_unavailable",
    );
    expect(output.start).not.toHaveBeenCalled();
    expect(output.stop).toHaveBeenCalledTimes(1);
  });
});
