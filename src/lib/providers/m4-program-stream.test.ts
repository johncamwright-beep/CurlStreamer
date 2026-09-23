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
});
