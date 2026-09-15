import { afterEach, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { M4ProgramStream } from "./m4-program-stream";
import type { M4NativeObservation } from "./m4-native-pipe";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("requires fresh independent native and provider evidence and invalidates it on Stop", async () => {
  vi.useFakeTimers();
  let clock = 0;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  const desktop = new M4DesktopClient(
    "11111111-1111-4111-8111-111111111111",
    "https://pilot.invalid",
  );
  vi.spyOn(desktop, "snapshot").mockReturnValue({
    state: "active",
    authorized: true,
  });
  vi.spyOn(desktop, "stop").mockResolvedValue({
    state: "stopped",
    authorized: false,
  });
  vi.spyOn(desktop, "handoffOutput").mockImplementation(
    async (_intent, receive) => {
      await receive(
        {
          serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
          streamKey: "canary",
        },
        20000,
      );
      return desktop.snapshot();
    },
  );
  vi.spyOn(desktop, "observeOutput").mockResolvedValue({
    streamStatus: "active",
    healthStatus: "good",
    broadcastStatus: "live",
    broadcastLive: true,
  });
  let authority: "connected" | "armed" | "stopped" = "connected";
  const native = {
    async arm() {
      authority = "armed";
    },
    async renew() {},
    async stop() {
      authority = "stopped";
    },
    disconnect() {},
    snapshot: () => ({
      state: authority,
      deliveryAttempted: authority !== "connected",
    }),
    observe: vi.fn(async (): Promise<M4NativeObservation> => ({
      state: authority === "stopped" ? "stopped" : "active",
      authority: authority === "stopped" ? 2 : 1,
      failure: "none",
      bytes: 20,
    })),
  };
  const stream = new M4ProgramStream(native);
  await stream.start(desktop, "intent");
  await vi.advanceTimersByTimeAsync(0);
  expect(stream.snapshot()).toMatchObject({
    state: "armed",
    liveConfirmed: true,
  });
  clock = 11000; // No new sample: a stale success must become unknown.
  expect(stream.snapshot()).toMatchObject({
    localOutput: { state: "unknown" },
    liveConfirmed: false,
  });
  expect(stream.snapshot().provider).toBeUndefined();
  await stream.stop();
  expect(stream.snapshot()).toMatchObject({
    state: "stopped",
    localOutput: { state: "stopped" },
    liveConfirmed: false,
  });
  expect(stream.snapshot().provider).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  clock += 6000;
  expect(stream.snapshot()).toMatchObject({
    state: "stopped",
    localOutput: { state: "unknown" },
    liveConfirmed: false,
  });
});
