import { afterEach, describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { M4ProgramStream } from "./m4-program-stream";

function fixture() {
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.invalid",
  );
  let state: "connected" | "armed" | "stopped" | "failed" = "connected";
  const native = {
    arm: vi.fn(async () => {
      state = "armed";
    }),
    renew: vi.fn(async () => undefined),
    stop: vi.fn(async () => {
      state = "stopped";
    }),
    snapshot: () => ({ state, deliveryAttempted: state !== "connected" }),
    disconnect: vi.fn(() => {
      if (state !== "stopped") state = "failed";
    }),
  };
  vi.spyOn(desktop, "snapshot").mockReturnValue({
    state: "active",
    authorized: true,
  });
  const handoff = vi
    .spyOn(desktop, "handoffOutput")
    .mockImplementation(async (_id, receive) => {
      await receive(
        {
          serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
          streamKey: "synthetic-canary",
        },
        20000,
      );
      return desktop.snapshot();
    });
  vi.spyOn(desktop, "remainingLeaseMs").mockReturnValue(20000);
  const heartbeat = vi.spyOn(desktop, "heartbeat").mockResolvedValue({
    state: "active",
    authorized: true,
    desiredAction: "wait",
    leaseRenewed: true,
  });
  const release = vi
    .spyOn(desktop, "stop")
    .mockResolvedValue({ state: "stopped", authorized: false });
  return {
    desktop,
    native,
    handoff,
    heartbeat,
    release,
    stream: new M4ProgramStream(native),
  };
}
afterEach(() => vi.useRealTimers());
describe("independent managed program stream", () => {
  it("pauses and resumes one delivered target while renewing authority, with Stop terminal", async () => {
    vi.useFakeTimers();
    const f = fixture();
    let output: "active" | "stopped" = "active";
    const native = {
      ...f.native,
      pause: vi.fn(async () => {
        output = "stopped";
      }),
      resume: vi.fn(async () => {
        output = "active";
      }),
      observe: vi.fn(async () => ({
        state:
          f.native.snapshot().state === "stopped"
            ? ("stopped" as const)
            : output,
        failure: "none" as const,
        authority: f.native.snapshot().state === "stopped" ? 2 : 1,
        bytes: output === "active" ? 1234 : 0,
      })),
    };
    vi.spyOn(f.desktop, "observeOutput").mockRejectedValue(
      new Error("provider unavailable"),
    );
    const stream = new M4ProgramStream(native);
    await stream.start(f.desktop, "intent");
    await stream.pause();
    expect(stream.snapshot()).toMatchObject({
      state: "paused",
      liveConfirmed: false,
      localOutput: { state: "stopped" },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(native.renew).toHaveBeenCalledOnce();
    expect(f.release).not.toHaveBeenCalled();
    await stream.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(stream.snapshot()).toMatchObject({
      state: "armed",
      localOutput: { state: "active" },
    });
    expect(f.handoff).toHaveBeenCalledOnce();
    expect(native.arm).toHaveBeenCalledOnce();
    await stream.stop();
    await expect(stream.resume()).rejects.toThrow();
    expect(native.resume).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cannot restore paused authority from a late observation after Stop", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const observation = {
      state: "stopped" as const,
      failure: "none" as const,
      authority: 1,
      bytes: 100,
    };
    const observe = vi.fn(async () => observation);
    const native = {
      ...f.native,
      observe,
      pause: vi.fn(async () => undefined),
      resume: vi.fn(async () => undefined),
    };
    vi.spyOn(f.desktop, "observeOutput").mockRejectedValue(
      new Error("offline"),
    );
    const stream = new M4ProgramStream(native);
    await stream.start(f.desktop, "intent");
    let deliver!: (value: typeof observation) => void;
    observe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          deliver = resolve;
        }),
    );
    const pausing = expect(stream.pause()).rejects.toThrow();
    await vi.waitFor(() => expect(deliver).toBeDefined());
    await stream.stop();
    deliver(observation);
    await pausing;
    expect(stream.snapshot().state).toBe("stopped");
    await expect(stream.resume()).rejects.toThrow();
    expect(native.resume).not.toHaveBeenCalled();
  });
  it("arms once, renews and stops without any recording capability", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.stream.start(f.desktop, "intent");
    expect(f.stream.snapshot()).toEqual({ state: "armed" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.native.renew).toHaveBeenCalledExactlyOnceWith(20000);
    await f.stream.stop();
    expect(f.stream.snapshot()).toEqual({ state: "stopped" });
    expect(f.native.stop).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    await expect(f.stream.start(f.desktop, "another-intent")).rejects.toThrow(
      "m4_program_stream_unavailable",
    );
    expect(f.handoff).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a pending handoff and refuses its late target", async () => {
    const f = fixture();
    let deliver!: () => void;
    f.handoff.mockImplementationOnce(async (_id, receive) => {
      await new Promise<void>((resolve) => {
        deliver = resolve;
      });
      await receive(
        {
          serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
          streamKey: "synthetic-canary",
        },
        20000,
      );
      return f.desktop.snapshot();
    });
    const started = expect(f.stream.start(f.desktop, "intent")).rejects.toThrow(
      "m4_program_stream_unavailable",
    );
    const stopped = f.stream.stop();
    deliver();
    await started;
    await expect(stopped).resolves.toBeUndefined();
    expect(f.stream.snapshot()).toEqual({ state: "stopped" });
    expect(f.native.arm).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.native.disconnect).toHaveBeenCalledOnce();
  });
  it("contains renewal failure after start and releases authority", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.heartbeat.mockRejectedValueOnce(new Error("private-provider-details"));
    await f.stream.start(f.desktop, "intent");
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.stream.snapshot()).toEqual({ state: "failed" });
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.native.stop).toHaveBeenCalledOnce();
    expect(JSON.stringify(f.stream.snapshot())).not.toContain("private");
    await expect(f.stream.stop()).rejects.toThrow(
      "m4_program_stream_unavailable",
    );
    expect(vi.getTimerCount()).toBe(0);
  });
  it("never consumes a target after its idle native connection is lost", async () => {
    const f = fixture();
    f.native.disconnect();
    expect(f.stream.snapshot()).toEqual({ state: "failed" });
    await expect(f.stream.start(f.desktop, "intent")).rejects.toThrow(
      "m4_program_stream_unavailable",
    );
    expect(f.handoff).not.toHaveBeenCalled();
  });
  it("revokes an unused stream channel without pairing or target delivery", async () => {
    const f = fixture();
    await f.stream.stop();
    await f.stream.stop();
    expect(f.stream.snapshot()).toEqual({ state: "stopped" });
    expect(f.native.stop).toHaveBeenCalledOnce();
    expect(f.handoff).not.toHaveBeenCalled();
    expect(f.release).not.toHaveBeenCalled();
  });
  it("preserves a native output failure as failed and records a fixed reason before cleanup", async () => {
    vi.useFakeTimers();
    const f = fixture();
    const diagnostic = vi.fn();
    const native = {
      ...f.native,
      observe: vi.fn(async () => ({
        state:
          f.native.snapshot().state === "stopped"
            ? ("stopped" as const)
            : ("failed" as const),
        failure: "output-error" as const,
        authority: 2,
        bytes: 100,
      })),
    };
    const stream = new M4ProgramStream(native, diagnostic);
    vi.spyOn(f.desktop, "observeOutput").mockRejectedValue(
      new Error("private-token"),
    );
    await stream.start(f.desktop, "intent");
    await vi.advanceTimersByTimeAsync(0);
    expect(stream.snapshot().state).toBe("failed");
    expect(diagnostic).toHaveBeenCalledWith("stream_failed", {
      reason: "native_output_error",
    });
    expect(
      diagnostic.mock.calls.filter(([event]) => event === "stream_failed"),
    ).toHaveLength(1);
    expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("private");
    expect(f.native.stop).toHaveBeenCalledOnce();
    expect(f.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
