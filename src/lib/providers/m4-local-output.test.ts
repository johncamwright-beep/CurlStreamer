import { afterEach, describe, expect, it, vi } from "vitest";
import { M4LocalOutput, type MemoryOutputPort } from "./m4-local-output";

const sessionId = "11111111-1111-4111-8111-111111111111";
const target = {
  server: "rtmps://a.rtmps.youtube.com/live2",
  key: "private-test-key",
};
function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(10_000);
  let active = false;
  const port = {
    start: vi.fn(async () => {
      active = true;
    }),
    stop: vi.fn(async () => {
      active = false;
    }),
    observe: vi.fn(async () => ({ active, reconnecting: false })),
  } satisfies MemoryOutputPort;
  const output = new M4LocalOutput(port);
  const lease = { sessionId, generation: 1, expiresAt: 20_000 };
  return { port, output, lease };
}
afterEach(() => vi.useRealTimers());

describe("M4 local output lifecycle core (mock encoder only)", () => {
  it("does not report sending when stop revokes a pending output observation", async () => {
    const { output, lease, port } = setup();
    await output.start(lease, target);
    let observe!: (value: { active: boolean; reconnecting: boolean }) => void;
    port.observe.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          observe = resolve;
        }),
    );
    const checked = output.check();
    await vi.advanceTimersByTimeAsync(0);
    const stopped = output.stop();
    observe({ active: true, reconnecting: false });
    expect((await checked).state).toBe("stopped");
    expect((await stopped).state).toBe("stopped");
    expect(port.stop).toHaveBeenCalled();
  });

  it("stops output activated by a timed-out start that later rejects", async () => {
    const { output, lease, port } = setup();
    let active = false;
    let rejectStart!: (error: Error) => void;
    port.start.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    port.stop.mockImplementation(async () => {
      active = false;
    });
    port.observe.mockImplementation(async () => ({
      active,
      reconnecting: false,
    }));
    const started = output
      .start(lease, target)
      .catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await started).toBe("stop_unconfirmed");
    expect(output.snapshot().state).toBe("uncertain");
    expect(port.stop).toHaveBeenCalledOnce();
    // The external action took effect despite its delayed rejection response.
    active = true;
    rejectStart(new Error(target.key));
    await vi.advanceTimersByTimeAsync(0);
    expect(active).toBe(false);
    expect(port.stop).toHaveBeenCalledTimes(2);
    expect(output.snapshot().state).toBe("stopped");
    expect(JSON.stringify(output.snapshot())).not.toContain(target.key);
  });

  it("requires bounded valid lease before delivering a target", async () => {
    const { port, output, lease } = setup();
    await expect(
      output.start({ ...lease, expiresAt: 50_001 }, target),
    ).rejects.toThrow("lease_invalid");
    expect(port.start).not.toHaveBeenCalled();
    expect(output.snapshot().targetDelivered).toBe(false);
  });
  it("observes actual output before reporting sending and never includes target in status", async () => {
    const { output, lease, port } = setup();
    const result = await output.start(lease, target);
    expect(result.state).toBe("sending");
    expect(port.observe).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain(target.key);
    expect(JSON.stringify(result)).not.toContain(target.server);
    await output.stop();
    await expect(output.start(lease, target)).rejects.toThrow();
    expect(port.start).toHaveBeenCalledOnce();
  });
  it("expires the lease and stops output without any recording operation", async () => {
    const { output, lease, port } = setup();
    await output.start(lease, target);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(output.snapshot().state).toBe("stopped");
    expect(port.stop).toHaveBeenCalledOnce();
    expect(() => output.renew({ ...lease, expiresAt: 25_000 })).toThrow(
      "lease_invalid",
    );
  });
  it("rejects changed session/generation and prevents shortening or reviving a lease", async () => {
    const { output, lease } = setup();
    await output.start(lease, target);
    expect(() => output.renew({ ...lease, generation: 2 })).toThrow();
    expect(() =>
      output.renew({
        ...lease,
        sessionId: "22222222-2222-4222-8222-222222222222",
      }),
    ).toThrow();
    expect(() => output.renew({ ...lease, expiresAt: 19_999 })).toThrow();
    output.renew({ ...lease, expiresAt: 25_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(output.snapshot().state).toBe("sending");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(output.snapshot().state).toBe("stopped");
  });
  it("does not trust a start acknowledgment with inactive output", async () => {
    const { output, lease, port } = setup();
    port.start.mockResolvedValue();
    await expect(output.start(lease, target)).rejects.toThrow(
      "start_unconfirmed",
    );
    expect(output.snapshot().state).toBe("stopped");
    expect(port.stop).toHaveBeenCalled();
  });
  it("reconciles a lost stop acknowledgment using observed inactive output", async () => {
    const { output, lease, port } = setup();
    await output.start(lease, target);
    port.stop.mockRejectedValue(new Error("private-test-key"));
    port.observe.mockResolvedValue({ active: false, reconnecting: false });
    expect((await output.stop()).state).toBe("stopped");
  });
  it("keeps an uncertain stop retryable and redacts provider errors", async () => {
    const { output, lease, port } = setup();
    await output.start(lease, target);
    port.stop.mockRejectedValue(new Error(target.key));
    await expect(output.stop()).rejects.toThrow("stop_unconfirmed");
    expect(output.snapshot().state).toBe("uncertain");
    port.observe.mockResolvedValue({ active: false, reconnecting: false });
    expect((await output.stop()).state).toBe("stopped");
  });
  it("stops reconnecting output instead of representing it as provider live", async () => {
    const { output, lease, port } = setup();
    await output.start(lease, target);
    port.observe.mockResolvedValueOnce({ active: true, reconnecting: true });
    expect((await output.check()).state).toBe("stopped");
    expect(output.snapshot().failure).toBe("output_lost");
  });
  it("fences stop against a pending start and cleans up when it eventually resolves", async () => {
    const { output, lease, port } = setup();
    let finish!: () => void;
    port.start.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const started = output
      .start(lease, target)
      .catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(0);
    const stopped = output.stop().catch((error: Error) => error.message);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await started).toBe("stop_unconfirmed");
    expect(await stopped).toBe("stop_unconfirmed");
    expect(output.snapshot().state).toBe("uncertain");
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(output.snapshot().state).toBe("stopped");
    expect(port.start).toHaveBeenCalledOnce();
  });
});
