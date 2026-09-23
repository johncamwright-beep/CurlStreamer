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
async function fixture() {
  let now = 0;
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ ...row, bearer: "b".repeat(43) }));
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
  it("connects successful server handoff to arm and only fresh heartbeat authority to renew", async () => {
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
