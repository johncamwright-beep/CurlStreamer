import { afterEach, describe, expect, it, vi } from "vitest";
const peer = vi.hoisted(() => ({
  created: vi.fn(),
  close: vi.fn(),
  receive: vi.fn().mockResolvedValue(undefined),
  inspect: vi.fn().mockResolvedValue({ direct: true }),
}));
vi.mock("./direct-peer", () => ({
  DirectPeer: class {
    constructor(value: unknown) {
      peer.created(value);
    }
    close = peer.close;
    receive = peer.receive;
    inspect = peer.inspect;
  },
}));
import { connectM4ProgramCamera } from "./m4-program-camera";
import { StudioTransportUnavailable } from "./studio-transport-error";
const ticket = {
  cameraRole: "camera-home",
  sessionId: "22222222-2222-4222-8222-222222222222",
  generation: 1,
  negotiationId: "33333333-3333-4333-8333-333333333333",
  assignmentGeneration: 1,
  expiresAt: Date.now() + 30000,
};
const hooks = () => ({
  role: "camera-home" as const,
  onVideo: vi.fn(),
  onMetrics: vi.fn(),
  onStop: vi.fn(),
});
afterEach(() => {
  vi.clearAllMocks();
  peer.inspect.mockResolvedValue({ direct: true });
  vi.useRealTimers();
});
describe("program renderer camera transport", () => {
  it("retains its peer for a timed-out path notification but stops on revoked authority", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const request = vi.fn(
      async (path: string, body: unknown, signal: AbortSignal) => {
        if (path.startsWith("/events/")) return { events: [] };
        if ((body as { action: string }).action === "connect") return ticket;
        return new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("timeout", "AbortError")),
            { once: true },
          ),
        );
      },
    );
    const handle = await connectM4ProgramCamera({ ...h, request });
    const options = peer.created.mock.calls[0][0] as {
      send(signal: { type: "path-confirmed" }): Promise<void>;
      onConfirmationFailure(cause: unknown): void;
    };
    const confirmation = options
      .send({ type: "path-confirmed" })
      .catch(options.onConfirmationFailure);
    await vi.advanceTimersByTimeAsync(8000);
    await confirmation;
    expect(h.onStop).not.toHaveBeenCalled();
    expect(peer.close).not.toHaveBeenCalled();
    expect(h.onMetrics).toHaveBeenCalledTimes(9);
    options.onConfirmationFailure(new Error("authority rejected"));
    expect(h.onStop).toHaveBeenCalledOnce();
    expect(peer.close).toHaveBeenCalledOnce();
    handle.stop();
  });
  it("retains the same peer through a temporary signaling outage and resumes polling", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const request = vi
      .fn()
      .mockResolvedValue({ events: [] })
      .mockResolvedValueOnce(ticket);
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.advanceTimersByTimeAsync(0);
    request.mockRejectedValueOnce(new StudioTransportUnavailable());
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(peer.created).toHaveBeenCalledTimes(1);
    expect(h.onStop).not.toHaveBeenCalled();
    expect(h.onMetrics).toHaveBeenCalledTimes(3);
    handle.stop();
  });
  it("times out direct verification even when an event request never settles", async () => {
    vi.useFakeTimers();
    peer.inspect.mockResolvedValue({ direct: false });
    const h = hooks();
    const request = vi
      .fn()
      .mockResolvedValueOnce(ticket)
      .mockImplementation(() => new Promise(() => {}));
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.advanceTimersByTimeAsync(46000);
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    handle.stop();
  });
  it("keeps inspecting healthy direct video during stalled event reads, without overlapping inspections", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const request = vi
      .fn()
      .mockResolvedValueOnce(ticket)
      .mockImplementation(() => new Promise(() => {}));
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.advanceTimersByTimeAsync(20000);
    expect(h.onMetrics).toHaveBeenCalledTimes(21);
    expect(peer.close).not.toHaveBeenCalled();
    expect(h.onStop).not.toHaveBeenCalled();
    const inspections = peer.inspect.mock.calls.length;
    let resolve!: (value: { direct: boolean }) => void;
    peer.inspect.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(3000);
    expect(peer.inspect).toHaveBeenCalledTimes(inspections + 1);
    handle.stop();
    resolve({ direct: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.onMetrics).toHaveBeenCalledTimes(21);
  });
  it("retries an aborted event read while keeping its peer, then stops on actual authority rejection", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const request = vi
      .fn()
      .mockResolvedValueOnce(ticket)
      .mockImplementationOnce(
        (_path, _body, signal: AbortSignal) =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("timed out", "AbortError")),
              { once: true },
            ),
          ),
      )
      .mockResolvedValue({ events: [] });
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.advanceTimersByTimeAsync(9000);
    expect(h.onStop).not.toHaveBeenCalled();
    expect(peer.created).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(3);
    request.mockRejectedValueOnce(new Error("authority revoked"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.onStop).toHaveBeenCalledTimes(1);
    expect(peer.close).toHaveBeenCalledTimes(1);
    handle.stop();
  });
  it("clears completed request deadlines while the camera poll remains active", async () => {
    vi.useFakeTimers();
    const h = hooks();
    const request = vi.fn().mockResolvedValue({ events: [] });
    request.mockResolvedValueOnce(ticket);
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.advanceTimersByTimeAsync(0);

    // Only the direct-path watchdog and the next one-second poll are pending.
    // Successful requests must not each retain their 8-second deadline.
    expect(vi.getTimerCount()).toBe(2);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(3);
    handle.stop();
  });
  it("rejects credential-bearing connection metadata before creating a peer", async () => {
    await expect(
      connectM4ProgramCamera({
        ...hooks(),
        request: vi
          .fn()
          .mockResolvedValue({ ...ticket, token: "private-token" }),
      }),
    ).rejects.toThrow("m4_program_camera_unavailable");
    expect(peer.created).not.toHaveBeenCalled();
  });
  it("does not create a peer when a connection arrives after cancellation", async () => {
    const controller = new AbortController();
    let resolve!: (v: unknown) => void;
    const pending = connectM4ProgramCamera({
      ...hooks(),
      signal: controller.signal,
      request: () =>
        new Promise((r) => {
          resolve = r;
        }),
    });
    controller.abort();
    resolve(ticket);
    await expect(pending).rejects.toThrow("m4_program_camera_unavailable");
    expect(peer.created).not.toHaveBeenCalled();
  });
  it("closes on a cross-camera event instead of delivering it to WebRTC", async () => {
    const h = hooks();
    const request = vi
      .fn()
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({
        events: [
          {
            ...ticket,
            cameraRole: "camera-away",
            from: "camera",
            messageId: "44444444-4444-4444-8444-444444444444",
            expiresAt: Date.now() + 10000,
            signal: { type: "ready" },
          },
        ],
      });
    const handle = await connectM4ProgramCamera({ ...h, request });
    await vi.waitFor(() => expect(h.onStop).toHaveBeenCalledTimes(1));
    handle.stop();
    expect(peer.receive).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalledTimes(1);
    expect(peer.created).toHaveBeenCalledWith(
      expect.objectContaining({ side: "receiver" }),
    );
  });
});
