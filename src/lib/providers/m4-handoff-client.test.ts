import { describe, expect, it, vi } from "vitest";
import { M4DesktopClient } from "./m4-desktop-client";
import { M4ApplicationOutput } from "./m4-application-output";
const game = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const intentId = "33333333-3333-4333-8333-333333333333";
const epoch = Date.parse("2026-09-08T10:00:00Z");
const row = {
  sessionId,
  generation: 1,
  expiresAt: new Date(epoch + 14400000).toISOString(),
  leaseExpiresAt: new Date(epoch + 30000).toISOString(),
};
const target = {
  serverUrl: "rtmps://a.rtmps.youtube.com:443/live2",
  streamKey: "canary_not_for_logs",
};
const reserved = {
  intentId,
  sessionId,
  generation: 1,
  phase: "reserved",
  deliveryRecorded: false,
};
function response(value: unknown, offset = 0) {
  return new Response(JSON.stringify(value), {
    headers: { date: new Date(epoch + offset).toUTCString() },
  });
}
async function fixture(leaseMs = 30000) {
  let now = 0;
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
    response({
      ...row,
      leaseExpiresAt: new Date(epoch + leaseMs).toISOString(),
      bearer: "b".repeat(43),
    }),
  );
  const client = new M4DesktopClient(game, "https://pilot.example", {
    fetcher,
    clock: () => now,
  });
  await client.exchange("c".repeat(43));
  fetcher.mockResolvedValueOnce(response(reserved));
  return {
    client,
    fetcher,
    advance: (value: number) => {
      now += value;
    },
  };
}
describe("once-only application handoff", () => {
  it.each([true, false])(
    "survives a 52-second transport outage then %s recovery without extending cached authority",
    async (recover) => {
      const { client, fetcher, advance } = await fixture(90000);
      const longRow = {
        ...row,
        leaseExpiresAt: new Date(epoch + 90000).toISOString(),
      };
      fetcher.mockResolvedValueOnce(response({ ...longRow, intentId, target }));
      const native = {
        arm: vi.fn(),
        renew: vi.fn(),
        stop: vi.fn(),
        snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
      };
      const app = new M4ApplicationOutput(client, native);
      await app.start(intentId);
      expect(native.arm).toHaveBeenCalledWith(target, 30000);
      for (let attempt = 0; attempt < 4; attempt++) {
        advance(13000);
        fetcher.mockRejectedValueOnce(new Error("temporary network loss"));
        await app.heartbeat();
        expect(native.renew).toHaveBeenLastCalledWith(30000);
        expect(native.stop).not.toHaveBeenCalled();
      }
      if (recover) {
        fetcher.mockResolvedValueOnce(
          response(
            {
              ...longRow,
              leaseExpiresAt: new Date(epoch + 142000).toISOString(),
              desiredAction: "wait",
            },
            52000,
          ),
        );
        await app.heartbeat();
        advance(20000);
        expect(client.remainingLeaseMs()).toBe(30000);
        expect(native.stop).not.toHaveBeenCalled();
      } else {
        advance(26000);
        fetcher.mockRejectedValueOnce(new Error("still offline"));
        await app.heartbeat();
        expect(native.renew).toHaveBeenLastCalledWith(8000);
        advance(12000);
        fetcher.mockResolvedValueOnce(
          response({ ...longRow, desiredAction: "stop" }, 90000),
        );
        await expect(app.heartbeat()).rejects.toThrow();
        expect(native.stop).toHaveBeenCalledOnce();
      }
      expect(native.arm).toHaveBeenCalledOnce();
    },
  );
  it("reads only the matching committed closing grant without renewing lease", async () => {
    const wall = vi.spyOn(Date, "now").mockReturnValue(epoch);
    try {
      const { client, fetcher } = await fixture();
      fetcher.mockResolvedValueOnce(response({ ...row, intentId, target }));
      await client.handoffOutput(intentId, async () => undefined);
      const remaining = client.remainingLeaseMs();
      const grant = {
        sessionId,
        generation: 1,
        intentId,
        deadlineAt: new Date(epoch + 15000).toISOString(),
      };
      fetcher.mockResolvedValueOnce(response(grant));
      await expect(client.closing()).resolves.toEqual(grant);
      expect(client.remainingLeaseMs()).toBe(remaining);
      expect(JSON.parse(fetcher.mock.calls.at(-1)![1]!.body as string)).toEqual(
        { action: "closing", sessionId, generation: 1 },
      );
      for (const invalid of [
        { ...grant, sessionId: intentId },
        { ...grant, generation: 2 },
        { ...grant, intentId: sessionId },
        { ...grant, deadlineAt: new Date(epoch - 1).toISOString() },
        { ...grant, deadlineAt: new Date(epoch + 31000).toISOString() },
      ]) {
        fetcher.mockResolvedValueOnce(response(invalid));
        await expect(client.closing()).rejects.toThrow();
      }
      fetcher.mockResolvedValueOnce(new Response(JSON.stringify(grant)));
      await expect(client.closing()).rejects.toThrow();
      expect(client.remainingLeaseMs()).toBe(remaining);
    } finally {
      wall.mockRestore();
    }
  });
  it("rejects premature heartbeat and fences a late arm after stop", async () => {
    const { client, fetcher } = await fixture();
    fetcher.mockResolvedValueOnce(response({ ...row, intentId, target }));
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    let finish!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const native = {
      arm: vi.fn(() => {
        entered();
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      }),
      renew: vi.fn(),
      stop: vi.fn().mockResolvedValue(undefined),
      snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
    };
    const app = new M4ApplicationOutput(client, native);
    const start = app.start(intentId);
    const rejected = expect(start).rejects.toThrow(
      "m4_application_output_unavailable",
    );
    await waiting;
    await expect(app.heartbeat()).rejects.toThrow();
    const stop = app.stop();
    finish();
    await rejected;
    await stop;
    await app.stop();
    expect(native.renew).not.toHaveBeenCalled();
    expect(native.stop).toHaveBeenCalledTimes(1);
  });
  it("delivers only to the local sink, consumes elapsed lease, and refuses redelivery", async () => {
    const { client, fetcher, advance } = await fixture();
    fetcher.mockImplementationOnce(async () => {
      advance(4500);
      return response({ ...row, intentId, target });
    });
    const receive = vi.fn().mockResolvedValue(undefined);
    const result = await client.handoffOutput(intentId, receive);
    expect(receive).toHaveBeenCalledWith(target, 21500);
    expect(JSON.stringify(result)).not.toContain(target.streamKey);
    expect(JSON.stringify(client)).not.toContain(target.streamKey);
    await expect(client.handoffOutput(intentId, receive)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("never repeats a lost target response", async () => {
    const { client, fetcher } = await fixture();
    fetcher.mockRejectedValueOnce(new Error(target.streamKey));
    const sink = vi.fn();
    await expect(client.handoffOutput(intentId, sink)).rejects.toThrow(
      "m4_desktop_client_unavailable",
    );
    await expect(client.handoffOutput(intentId, sink)).rejects.toThrow();
    expect(sink).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("fences a target arriving after stop", async () => {
    const { client, fetcher } = await fixture();
    let finish!: (r: Response) => void;
    let requested!: () => void;
    const started = new Promise<void>((r) => {
      requested = r;
    });
    fetcher.mockImplementationOnce(() => {
      requested();
      return new Promise<Response>((r) => {
        finish = r;
      });
    });
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    const sink = vi.fn();
    const handoff = client.handoffOutput(intentId, sink);
    await started;
    const stopped = client.stop();
    finish(response({ ...row, intentId, target }));
    await expect(handoff).rejects.toThrow();
    await stopped;
    expect(sink).not.toHaveBeenCalled();
  });
  it.each(["binding", "expired", "relay"])(
    "rejects %s target responses before the pipe",
    async (failure) => {
      const { client, fetcher, advance } = await fixture();
      if (failure === "expired") advance(29000);
      fetcher.mockResolvedValueOnce(
        response({
          ...row,
          intentId,
          ...(failure === "binding" ? { generation: 2 } : {}),
          target:
            failure === "relay"
              ? { ...target, serverUrl: "rtmp://other.invalid/live2" }
              : target,
        }),
      );
      const sink = vi.fn();
      await expect(client.handoffOutput(intentId, sink)).rejects.toThrow();
      expect(sink).not.toHaveBeenCalled();
    },
  );
  it("feeds native watchdog only within acknowledged authority, including transport failure", async () => {
    const { client, fetcher, advance } = await fixture();
    fetcher.mockResolvedValueOnce(response({ ...row, intentId, target }));
    const native = {
      arm: vi.fn().mockResolvedValue(undefined),
      renew: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      snapshot: () => ({ state: "armed" as const, deliveryAttempted: true }),
    };
    const app = new M4ApplicationOutput(client, native);
    await app.start(intentId);
    expect(native.arm).toHaveBeenCalledWith(target, 26000);
    advance(5000);
    fetcher.mockResolvedValueOnce(
      response(
        {
          ...row,
          leaseExpiresAt: new Date(epoch + 35000).toISOString(),
          desiredAction: "wait",
        },
        5000,
      ),
    );
    await app.heartbeat();
    expect(native.renew).toHaveBeenCalledWith(26000);
    fetcher.mockRejectedValueOnce(new Error("provider unavailable"));
    advance(5000);
    await app.heartbeat();
    expect(native.stop).not.toHaveBeenCalled();
    expect(native.renew).toHaveBeenCalledTimes(2);
    expect(native.renew).toHaveBeenLastCalledWith(21000);
    // Transport loss cannot extend the acknowledged deadline. Explicit revocation
    // still stops immediately and never delivers the destination again.
    fetcher.mockResolvedValueOnce(new Response("revoked", { status: 403 }));
    fetcher.mockResolvedValueOnce(
      response({ ...row, desiredAction: "stop" }, 5000),
    );
    await expect(app.heartbeat()).rejects.toThrow(
      "m4_application_output_unavailable",
    );
    expect(native.stop).toHaveBeenCalledTimes(1);
    await expect(app.start(intentId)).rejects.toThrow();
  });
  it("attempts both cleanups after uncertain native delivery without retrying arm", async () => {
    const { client, fetcher } = await fixture();
    fetcher.mockResolvedValueOnce(response({ ...row, intentId, target }));
    fetcher.mockResolvedValueOnce(response({ ...row, desiredAction: "stop" }));
    const native = {
      arm: vi.fn().mockRejectedValue(new Error(target.streamKey)),
      renew: vi.fn(),
      stop: vi.fn().mockRejectedValue(new Error("closed")),
      snapshot: () => ({ state: "failed" as const, deliveryAttempted: true }),
    };
    const app = new M4ApplicationOutput(client, native);
    await expect(app.start(intentId)).rejects.toThrow(
      "m4_application_output_unavailable",
    );
    expect(native.arm).toHaveBeenCalledTimes(1);
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(client.snapshot().state).toBe("stopped");
  });
});
