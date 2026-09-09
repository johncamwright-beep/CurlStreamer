import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StudioTicket } from "@/lib/m2-studio-protocol";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  peers: [] as Array<{
    receive: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    inspect: ReturnType<typeof vi.fn>;
  }>,
  messages: [] as Array<(value: unknown) => void>,
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./direct-peer", () => ({
  DirectPeer: class {
    pc = { remoteDescription: {}, connectionState: "connected" };
    receive = vi.fn();
    close = vi.fn();
    inspect = vi.fn().mockResolvedValue({ direct: true, relayBytes: 0 });
    constructor() {
      mocks.peers.push(this);
    }
  },
}));
import { connectStudio, type StudioRequest } from "./m2-studio-browser";
function ticket(cameraRole: "camera-home" | "camera-away"): StudioTicket {
  return {
    cameraRole,
    sessionId: "00000000-0000-4000-8000-000000000001",
    negotiationId: "00000000-0000-4000-8000-000000000002",
    generation: 1,
    assignmentGeneration: 3,
    expiresAt: Date.now() + 20_000,
    token: "synthetic-scoped",
    topic: `synthetic-${cameraRole}`,
  };
}
function message(value: StudioTicket, overrides: object = {}) {
  return {
    payload: {
      cameraRole: value.cameraRole,
      sessionId: value.sessionId,
      negotiationId: value.negotiationId,
      generation: value.generation,
      assignmentGeneration: value.assignmentGeneration,
      from: "camera",
      messageId: crypto.randomUUID(),
      expiresAt: Date.now() + 10_000,
      signal: { type: "ready" },
      ...overrides,
    },
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  mocks.peers.length = 0;
  mocks.messages.length = 0;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://disposable.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  mocks.createClient.mockImplementation(() => {
    const channel = {
      on: vi.fn(
        (
          _type: unknown,
          _event: unknown,
          callback: (value: unknown) => void,
        ) => {
          mocks.messages.push(callback);
          return channel;
        },
      ),
      subscribe: vi.fn((callback: (status: string) => void) =>
        callback("SUBSCRIBED"),
      ),
    };
    return {
      channel: vi.fn(() => channel),
      realtime: { setAuth: vi.fn() },
      removeChannel: vi.fn(),
    };
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("M2 camera role authority and independent connections", () => {
  it.each([-60000, 60000])(
    "accepts fresh offers with a device clock offset of %i ms, while rejecting expired and overlong messages",
    async (offset) => {
      const serverTime = Date.now();
      const initial = { ...ticket("camera-away"), serverTime };
      vi.setSystemTime(serverTime + offset);
      const onStop = vi.fn(),
        onMetrics = vi.fn();
      const connection = await connectStudio({
        side: "camera",
        ticket: initial,
        request: vi.fn<StudioRequest>().mockResolvedValue(initial),
        onVideo: vi.fn(),
        onMetrics,
        onStop,
      });
      for (const expiresAt of [
        serverTime + 10000,
        serverTime - 1,
        serverTime + 16000,
      ]) {
        mocks.messages[0](
          message(initial, {
            from: "receiver",
            signal: { type: "offer", sdp: "v=0" },
            expiresAt,
          }),
        );
      }
      await vi.advanceTimersByTimeAsync(1000);
      expect(mocks.peers[0].receive).toHaveBeenCalledTimes(1);
      expect(onMetrics.mock.lastCall?.[0].signaling).toEqual({
        received: 3,
        accepted: 1,
        expired: 2,
        rejected: 0,
      });
      expect(onStop).not.toHaveBeenCalled();
      connection.stop();
    },
  );
  it("does not extend an offer's validity during a slow authority check", async () => {
    const serverTime = Date.now();
    const initial = { ...ticket("camera-away"), serverTime };
    const request = vi.fn<StudioRequest>().mockResolvedValue(initial);
    const connection = await connectStudio({
      side: "camera",
      ticket: initial,
      request,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
      onStop: vi.fn(),
    });
    request.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(initial), 2000)),
    );
    mocks.messages[0](
      message(initial, {
        from: "receiver",
        signal: { type: "offer", sdp: "v=0" },
        expiresAt: serverTime + 1000,
      }),
    );
    await vi.advanceTimersByTimeAsync(2500);
    expect(mocks.peers[0].receive).not.toHaveBeenCalled();
    connection.stop();
  });
  it("distinguishes missing return traffic from rejected and expired envelopes without exposing payloads", async () => {
    const initial = ticket("camera-away");
    const onMetrics = vi.fn();
    const connection = await connectStudio({
      side: "camera",
      ticket: initial,
      request: vi.fn<StudioRequest>().mockResolvedValue(initial),
      onVideo: vi.fn(),
      onMetrics,
      onStop: vi.fn(),
    });
    const offer = { from: "receiver", signal: { type: "offer", sdp: "v=0" } };
    mocks.messages[0](
      message(initial, { ...offer, expiresAt: Date.now() - 1 }),
    );
    mocks.messages[0](
      message(initial, { ...offer, cameraRole: "camera-home" }),
    );
    mocks.messages[0](message(initial, offer));
    await vi.advanceTimersByTimeAsync(1000);
    expect(onMetrics.mock.lastCall?.[0].signaling).toEqual({
      received: 3,
      accepted: 1,
      expired: 1,
      rejected: 1,
    });
    expect(mocks.peers[0].receive).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(onMetrics.mock.lastCall?.[0])).not.toContain("v=0");
    connection.stop();
  });
  it("rejects another camera role even when all session fields match, and checks authority before valid delivery", async () => {
    const initial = ticket("camera-away");
    const request = vi.fn<StudioRequest>().mockResolvedValue(initial);
    const connection = await connectStudio({
      side: "receiver",
      ticket: initial,
      request,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
      onStop: vi.fn(),
    });
    expect(request).toHaveBeenCalledOnce();
    request.mockClear();
    mocks.messages[0](message(initial, { cameraRole: "camera-home" }));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    expect(mocks.peers[0].receive).not.toHaveBeenCalled();
    const valid = message(initial);
    mocks.messages[0](valid);
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledExactlyOnceWith({
      action: "check",
      cameraRole: "camera-away",
      side: "receiver",
      sessionId: initial.sessionId,
      negotiationId: initial.negotiationId,
    });
    expect(mocks.peers[0].receive).toHaveBeenCalledExactlyOnceWith({
      type: "ready",
    });
    mocks.messages[0](valid);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.peers[0].receive).toHaveBeenCalledTimes(1);
    request.mockRejectedValueOnce(Error("released"));
    mocks.messages[0](message(initial));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.peers[0].receive).toHaveBeenCalledTimes(1);
    expect(mocks.peers[0].close).toHaveBeenCalledOnce();
    connection.stop();
  });
  it("rejects a renewal ticket for the other role without replacing the scoped credential", async () => {
    const initial = ticket("camera-away");
    const onStop = vi.fn();
    const request = vi
      .fn<StudioRequest>()
      .mockResolvedValueOnce(initial)
      .mockResolvedValue({ ...initial, cameraRole: "camera-home" });
    await connectStudio({
      side: "receiver",
      ticket: initial,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ticket", cameraRole: "camera-away" }),
    );
    expect(
      mocks.createClient.mock.results[0].value.realtime.setAuth,
    ).toHaveBeenCalledTimes(1);
    expect(onStop).toHaveBeenCalledOnce();
    expect(mocks.peers[0].close).toHaveBeenCalledOnce();
  });
  it("expires one hung camera while the other keeps its own monitoring and renewal timers", async () => {
    const home = ticket("camera-home"),
      away = ticket("camera-away");
    const homeStop = vi.fn(),
      awayStop = vi.fn(),
      homeTrackStop = vi.fn(),
      awayTrackStop = vi.fn();
    const awayMetrics = vi.fn();
    const hung = vi
      .fn<StudioRequest>()
      .mockResolvedValueOnce(home)
      .mockReturnValue(new Promise(() => {}));
    const renewing = vi.fn<StudioRequest>().mockImplementation(async () => ({
      ...away,
      expiresAt: Date.now() + 20_000,
    }));
    const first = await connectStudio({
      side: "camera",
      ticket: home,
      request: hung,
      track: { stop: homeTrackStop } as unknown as MediaStreamTrack,
      onStop: homeStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    const second = await connectStudio({
      side: "camera",
      ticket: away,
      request: renewing,
      track: { stop: awayTrackStop } as unknown as MediaStreamTrack,
      onStop: awayStop,
      onVideo: vi.fn(),
      onMetrics: awayMetrics,
    });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(homeStop).toHaveBeenCalledExactlyOnceWith(
      "Studio authority expired. Capture stopped.",
    );
    expect(homeTrackStop).toHaveBeenCalledOnce();
    expect(awayStop).not.toHaveBeenCalled();
    expect(awayTrackStop).not.toHaveBeenCalled();
    const previous = awayMetrics.mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(awayMetrics.mock.calls.length).toBeGreaterThan(previous);
    expect(
      renewing.mock.calls.every(([body]) => body.cameraRole === "camera-away"),
    ).toBe(true);
    expect(mocks.createClient).toHaveBeenCalledTimes(2);
    expect(
      mocks.createClient.mock.results[0].value.removeChannel,
    ).toHaveBeenCalledOnce();
    expect(
      mocks.createClient.mock.results[1].value.removeChannel,
    ).not.toHaveBeenCalled();
    first.stop();
    second.stop();
    expect(homeTrackStop).toHaveBeenCalledOnce();
    expect(awayTrackStop).toHaveBeenCalledOnce();
  });
});
