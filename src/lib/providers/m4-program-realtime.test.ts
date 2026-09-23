import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createM4ProgramRealtime,
  type M4RealtimeTransport,
} from "./m4-program-realtime";
import type { CameraRole } from "../m2-studio-protocol";

const session = "11111111-1111-4111-8111-111111111111";
const negotiation = "22222222-2222-4222-8222-222222222222";
function ticket(role: CameraRole = "camera-home") {
  return {
    cameraRole: role,
    sessionId: session,
    generation: 1,
    negotiationId: negotiation,
    assignmentGeneration: 2,
    expiresAt: Date.now() + 20000,
    token: "private-token",
    topic: `m2:${role}:${session}:1:${negotiation}:receiver`,
  };
}
function message(extra: Record<string, unknown> = {}) {
  return {
    cameraRole: "camera-home",
    sessionId: session,
    generation: 1,
    negotiationId: negotiation,
    assignmentGeneration: 2,
    expiresAt: Date.now() + 14000,
    from: "camera",
    messageId: randomUUID(),
    signal: { type: "ready" },
    ...extra,
  };
}
function fixture() {
  const action = vi.fn(
    async (body: { action: string; cameraRole: CameraRole }) =>
      ticket(body.cameraRole),
  );
  const client = { active: true, action };
  const subscriptions: Array<{
    options: Parameters<M4RealtimeTransport>[0];
    close: ReturnType<typeof vi.fn>;
    renew: ReturnType<typeof vi.fn>;
  }> = [];
  const transport: M4RealtimeTransport = (options) => {
    const close = vi.fn(async () => undefined),
      renew = vi.fn(async () => undefined);
    subscriptions.push({ options, close, renew });
    return { ready: Promise.resolve(), close, renew };
  };
  const relay = createM4ProgramRealtime({
    client,
    url: "https://project.supabase.co",
    key: "public-key",
    transport,
  });
  return { relay, client, subscriptions };
}
afterEach(() => vi.useRealTimers());

describe("Node-owned program realtime boundary", () => {
  it.each(["close", "timeout", "expiry"] as const)(
    "settles never-ready subscription on %s and bounds stuck cleanup",
    async (mode) => {
      vi.useFakeTimers();
      const f = fixture();
      if (mode === "expiry")
        f.client.action.mockResolvedValueOnce(ticket()).mockResolvedValueOnce({
          ...ticket(),
          expiresAt: Date.now() + 1200,
        });
      let created = false;
      let rejectLate!: (error: Error) => void;
      const cleanup = vi.fn(() => new Promise<void>(() => undefined));
      const relay = createM4ProgramRealtime({
        client: f.client,
        url: "https://project.supabase.co",
        key: "public-key",
        transport: () => {
          created = true;
          return {
            ready: new Promise<void>((_, reject) => {
              rejectLate = reject;
            }),
            renew: async () => undefined,
            close: cleanup,
          };
        },
      });
      const pending = relay.connect("camera-home");
      const assertion = expect(pending).rejects.toThrow(
        /^m4_program_realtime_unavailable$/,
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(created).toBe(true);
      const closing = mode === "close" ? relay.close() : undefined;
      await vi.advanceTimersByTimeAsync(
        mode === "timeout" ? 8000 : mode === "expiry" ? 500 : 1,
      );
      await assertion;
      const finished = closing ?? relay.close();
      await vi.advanceTimersByTimeAsync(2000);
      await finished;
      expect(cleanup).toHaveBeenCalledTimes(1);
      // The bounded race must retain a rejection handler on abandoned work.
      rejectLate(new Error("private-late-transport-error"));
      await Promise.resolve();
      await f.relay.close();
    },
  );
  it("isolates a transport failure to its camera and closes the private subscription", async () => {
    const f = fixture();
    try {
      await f.relay.connect("camera-home");
      expect(f.client.action.mock.calls.slice(0, 2)).toEqual([
        [{ action: "check", cameraRole: "camera-home" }],
        [{ action: "ticket", cameraRole: "camera-home" }],
      ]);
      await f.relay.connect("camera-away");
      f.subscriptions[0].options.failed();
      await expect(f.relay.drain("camera-home")).rejects.toThrow(
        /^m4_program_realtime_unavailable$/,
      );
      expect(f.subscriptions[0].close).toHaveBeenCalledTimes(1);
      expect(await f.relay.drain("camera-away")).toEqual([]);
      expect(f.subscriptions[1].close).not.toHaveBeenCalled();
    } finally {
      await f.relay.close();
    }
  });
  it("isolates each camera subscription and never projects private credentials", async () => {
    const f = fixture();
    try {
      const safe = await f.relay.connect("camera-home");
      await f.relay.connect("camera-away");
      expect(safe).not.toHaveProperty("token");
      expect(safe).not.toHaveProperty("topic");
      expect(f.subscriptions).toHaveLength(2);
      expect(f.subscriptions[0].options.topic).not.toBe(
        f.subscriptions[1].options.topic,
      );
      const incoming = message();
      f.subscriptions[0].options.receive(incoming);
      f.subscriptions[0].options.receive(incoming);
      expect(await f.relay.drain("camera-home")).toEqual([incoming]);
      expect(await f.relay.drain("camera-home")).toEqual([]);
      expect(await f.relay.drain("camera-away")).toEqual([]);
      expect(JSON.stringify(await f.relay.drain("camera-home"))).not.toContain(
        "private-token",
      );
      expect(
        f.client.action.mock.calls.filter(([body]) => body.action === "check")
          .length,
      ).toBeGreaterThanOrEqual(2);
    } finally {
      await f.relay.close();
    }
    expect(f.subscriptions.every((s) => s.close.mock.calls.length === 1)).toBe(
      true,
    );
  });
  it("rejects mismatched, expired, remote-candidate and wrong-direction envelopes", async () => {
    const f = fixture();
    try {
      await f.relay.connect("camera-home");
      for (const change of [
        { cameraRole: "camera-away" },
        { sessionId: randomUUID() },
        { generation: 2 },
        { negotiationId: randomUUID() },
        { assignmentGeneration: 3 },
        { from: "receiver" },
        { expiresAt: Date.now() - 1 },
        { expiresAt: Date.now() + 20000 },
        { signal: { type: "offer", sdp: "v=0" } },
        {
          signal: {
            type: "answer",
            sdp: "a=candidate:1 1 udp 1 1.2.3.4 123 typ relay",
          },
        },
        { secret: "must not forward" },
      ])
        f.subscriptions[0].options.receive(message(change));
      expect(await f.relay.drain("camera-home")).toEqual([]);
      expect(f.client.action).toHaveBeenCalledTimes(3);
    } finally {
      await f.relay.close();
    }
  });
  it("drops in-flight authority checks after close", async () => {
    const f = fixture();
    await f.relay.connect("camera-home");
    let resolve!: (value: ReturnType<typeof ticket>) => void;
    f.client.action.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    f.subscriptions[0].options.receive(message());
    await Promise.resolve();
    await Promise.resolve();
    await f.relay.close();
    resolve(ticket());
    await expect(f.relay.drain("camera-home")).rejects.toThrow(
      /^m4_program_realtime_unavailable$/,
    );
  });
  it("rechecks database authority before releasing a previously queued message", async () => {
    const f = fixture();
    try {
      await f.relay.connect("camera-home");
      f.subscriptions[0].options.receive(message());
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      f.client.action.mockRejectedValueOnce(
        new Error("private-upstream-error"),
      );
      await expect(f.relay.drain("camera-home")).rejects.toThrow(
        /^m4_program_realtime_unavailable$/,
      );
      expect(f.subscriptions[0].close).toHaveBeenCalled();
    } finally {
      await f.relay.close();
    }
  });
  it("bounds incoming work instead of accumulating an unbounded promise chain", async () => {
    const f = fixture();
    try {
      await f.relay.connect("camera-home");
      for (let i = 0; i < 40; ++i)
        f.subscriptions[0].options.receive(message());
      await expect(f.relay.drain("camera-home")).rejects.toThrow(
        /^m4_program_realtime_unavailable$/,
      );
      expect(f.subscriptions[0].close).toHaveBeenCalledTimes(1);
    } finally {
      await f.relay.close();
    }
  });
  it("does not install a late ticket after the same role is superseded", async () => {
    const f = fixture();
    let resolve!: (value: ReturnType<typeof ticket>) => void;
    f.client.action.mockResolvedValueOnce(ticket()).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const old = f.relay.connect("camera-home");
    await Promise.resolve();
    await Promise.resolve();
    await f.relay.connect("camera-home");
    resolve(ticket());
    await expect(old).rejects.toThrow(/^m4_program_realtime_unavailable$/);
    expect(f.subscriptions).toHaveLength(1);
    await f.relay.close();
  });
  it("tears down on independent lease expiry", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.client.action.mockResolvedValueOnce(ticket()).mockResolvedValueOnce({
      ...ticket(),
      expiresAt: Date.now() + 1200,
    });
    await f.relay.connect("camera-home");
    await vi.advanceTimersByTimeAsync(500);
    expect(f.subscriptions[0].close).toHaveBeenCalledTimes(1);
    await expect(f.relay.drain("camera-home")).rejects.toThrow(
      /^m4_program_realtime_unavailable$/,
    );
    await f.relay.close();
  });
  it("rejects a renewal that changes assignment identity", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.relay.connect("camera-home");
    f.client.action.mockResolvedValueOnce({
      ...ticket(),
      assignmentGeneration: 3,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(f.subscriptions[0].close).toHaveBeenCalledTimes(1);
    expect(f.subscriptions[0].renew).not.toHaveBeenCalled();
    await f.relay.close();
  });
  it("keeps renewal requests non-overlapping and tokens private", async () => {
    vi.useFakeTimers();
    const f = fixture();
    await f.relay.connect("camera-home");
    let resolve!: (value: ReturnType<typeof ticket>) => void;
    f.client.action.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(10000);
    expect(f.client.action).toHaveBeenCalledTimes(3);
    resolve(ticket());
    await vi.advanceTimersByTimeAsync(1);
    expect(f.subscriptions[0].renew).toHaveBeenCalledWith("private-token");
    await f.relay.close();
  });
});
