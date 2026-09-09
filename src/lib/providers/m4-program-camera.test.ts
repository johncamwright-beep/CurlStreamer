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
  vi.useRealTimers();
});
describe("program renderer camera transport", () => {
  it("times out direct verification even when an event request never settles", async () => {
    vi.useFakeTimers();
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
