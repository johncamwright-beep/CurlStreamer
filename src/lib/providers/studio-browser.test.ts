import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  receive: vi.fn(),
  close: vi.fn(),
  inspect: vi.fn(),
  onMessage: undefined as undefined | ((value: unknown) => void),
  onFailure: undefined as
    | undefined
    | ((
        reason: string,
        metrics?: import("./direct-peer").DirectMetrics,
      ) => void),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("./direct-peer", () => ({
  DirectPeer: class {
    constructor(options: { onFailure: typeof mocks.onFailure }) {
      mocks.onFailure = options.onFailure;
    }
    pc = { remoteDescription: {}, connectionState: "connected" };
    receive = mocks.receive;
    close = mocks.close;
    inspect = mocks.inspect;
  },
}));
import { connectStudio, type StudioRequest } from "./studio-browser";
const ticket = {
  sessionId: "00000000-0000-4000-8000-000000000001",
  negotiationId: "00000000-0000-4000-8000-000000000002",
  generation: 1,
  assignmentGeneration: 3,
  expiresAt: 0,
  token: "scoped-test",
  topic: "test-private-topic",
};
function message(overrides: object = {}) {
  return {
    payload: {
      sessionId: ticket.sessionId,
      negotiationId: ticket.negotiationId,
      generation: 1,
      assignmentGeneration: 3,
      from: "camera",
      messageId: crypto.randomUUID(),
      expiresAt: Date.now() + 10_000,
      signal: { type: "ready" },
      ...overrides,
    },
  };
}
describe("M1 receive authority and resource lifetime", () => {
  it("records the rejected sample before reporting shutdown", async () => {
    const events: string[] = [];
    const onMetrics = vi.fn(() => events.push("metrics"));
    await connectStudio({
      side: "receiver",
      ticket,
      request: vi.fn(),
      onVideo: vi.fn(),
      onMetrics,
      onStop: () => {
        events.push("stop");
      },
    });
    const metrics = {
      direct: false,
      path: "rejected",
      relayBytes: 0,
    } as import("./direct-peer").DirectMetrics;
    mocks.onFailure!("Path check stopped", metrics);
    expect(onMetrics).toHaveBeenCalledWith(metrics);
    expect(events).toEqual(["metrics", "stop"]);
    mocks.onFailure!("late", metrics);
    expect(events).toEqual(["metrics", "stop"]);
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://disposable.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-test");
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
    const channel = {
      on: vi.fn(
        (
          _type: unknown,
          _event: unknown,
          callback: (value: unknown) => void,
        ) => {
          mocks.onMessage = callback;
          return channel;
        },
      ),
      subscribe: vi.fn((callback: (status: string) => void) =>
        callback("SUBSCRIBED"),
      ),
    };
    mocks.createClient.mockReturnValue({
      channel: vi.fn(() => channel),
      realtime: { setAuth: vi.fn() },
      removeChannel: vi.fn(),
    });
    mocks.inspect.mockResolvedValue({ direct: true, relayBytes: 0 });
    ticket.expiresAt = Date.now() + 20_000;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  it("rejects wrong generations and revalidates before applying an incoming message", async () => {
    const request = vi.fn<StudioRequest>().mockResolvedValue(ticket),
      onStop = vi.fn();
    const connection = await connectStudio({
      side: "receiver",
      ticket,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    mocks.onMessage!(message({ generation: 99 }));
    await vi.advanceTimersByTimeAsync(0);
    expect(request).not.toHaveBeenCalled();
    mocks.onMessage!(message());
    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "check",
        negotiationId: ticket.negotiationId,
      }),
    );
    expect(mocks.receive).toHaveBeenCalledOnce();
    request.mockRejectedValueOnce(Error("completion"));
    mocks.onMessage!(message());
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.receive).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalledOnce();
    connection.stop();
  });
  it("stops capture if renewal hangs past the short authority deadline", async () => {
    const stop = vi.fn(),
      onStop = vi.fn();
    const request = vi
      .fn<StudioRequest>()
      .mockReturnValue(new Promise(() => {}));
    await connectStudio({
      side: "camera",
      ticket,
      track: { stop } as unknown as MediaStreamTrack,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(stop).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });
  it("stops an old peer when credential renewal reports a new negotiation", async () => {
    const onStop = vi.fn(),
      request = vi
        .fn<StudioRequest>()
        .mockResolvedValue({ ...ticket, negotiationId: crypto.randomUUID() });
    await connectStudio({
      side: "receiver",
      ticket,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(onStop).toHaveBeenCalledOnce();
  });
  it("survives a missing stats sample after three minutes but bounds sustained loss", async () => {
    const onStop = vi.fn();
    const request = vi.fn<StudioRequest>().mockImplementation(async () => ({
      ...ticket,
      expiresAt: Date.now() + 20_000,
    }));
    await connectStudio({
      side: "receiver",
      ticket,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(onStop).not.toHaveBeenCalled();
    mocks.inspect.mockResolvedValueOnce({
      direct: false,
      path: "pending",
      relayBytes: 0,
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(onStop).not.toHaveBeenCalled();
    mocks.inspect.mockResolvedValue({
      direct: false,
      path: "pending",
      relayBytes: 0,
    });
    await vi.advanceTimersByTimeAsync(12_000);
    expect(onStop).toHaveBeenCalledWith(
      "Direct path statistics unavailable for 10 seconds. Connection stopped.",
    );
  });
  it("still bounds startup without any verified path", async () => {
    const onStop = vi.fn();
    mocks.inspect.mockResolvedValue({
      direct: false,
      path: "pending",
      relayBytes: 0,
    });
    const request = vi.fn<StudioRequest>().mockImplementation(async () => ({
      ...ticket,
      expiresAt: Date.now() + 20_000,
    }));
    await connectStudio({
      side: "receiver",
      ticket,
      request,
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(47_000);
    expect(onStop).toHaveBeenCalledWith(
      "No verified direct path within 45 seconds. Reconnect both pages.",
    );
  });
  it("does not subscribe when cancelled during authentication", async () => {
    const db = mocks.createClient.mock.results[0]?.value;
    // Obtain the configured client without starting a connection yet.
    const client = db ?? mocks.createClient();
    let authenticated!: () => void;
    client.realtime.setAuth.mockReturnValue(
      new Promise<void>((resolve) => {
        authenticated = resolve;
      }),
    );
    const controller = new AbortController();
    const onStop = vi.fn();
    const pending = connectStudio({
      side: "receiver",
      ticket,
      signal: controller.signal,
      request: vi.fn(),
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    const rejected = expect(pending).rejects.toThrow("Connection cancelled");
    controller.abort();
    authenticated();
    await rejected;
    expect(client.channel).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });
  it("cancels a pending subscription immediately without a late failure", async () => {
    const client = mocks.createClient();
    const channel = client.channel();
    channel.subscribe.mockImplementation(() => {});
    const controller = new AbortController();
    const onStop = vi.fn();
    const pending = connectStudio({
      side: "receiver",
      ticket,
      signal: controller.signal,
      request: vi.fn(),
      onStop,
      onVideo: vi.fn(),
      onMetrics: vi.fn(),
    });
    const rejected = expect(pending).rejects.toThrow("Connection cancelled");
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    await vi.advanceTimersByTimeAsync(11_000);
    expect(client.removeChannel).toHaveBeenCalledWith(channel);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(onStop).not.toHaveBeenCalled();
  });
});
