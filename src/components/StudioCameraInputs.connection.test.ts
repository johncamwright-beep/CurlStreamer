import { afterEach, describe, expect, it, vi } from "vitest";
import { cameraInputNativeConnection } from "./StudioCameraInputs";

function bridge() {
  const events = new EventTarget();
  const postMessage = vi.fn();
  const removeEventListener = vi.fn(events.removeEventListener.bind(events));
  vi.stubGlobal("window", {
    setTimeout,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener,
    chrome: { webview: { postMessage } },
  });
  const acknowledge = (index = 0, extra: object = {}) => {
    const { action, ...sent } = postMessage.mock.calls[index][0];
    const event = new Event("studio-camera-connection-result");
    Object.assign(event, {
      detail: {
        ...sent,
        ok: true,
        connectionEnabled: action === "connect-camera",
        generation: 3,
        ...extra,
      },
    });
    events.dispatchEvent(event);
  };
  return { postMessage, acknowledge, removeEventListener };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("native camera connection receipts", () => {
  it("correlates game, role and nonce before acknowledging connection intent", async () => {
    const f = bridge();
    const pending = cameraInputNativeConnection(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    const resolved = vi.fn();
    void pending.then(resolved);
    expect(f.postMessage).toHaveBeenCalledWith({
      action: "connect-camera",
      gameId: "game-1",
      cameraRole: "camera-home",
      nonce: expect.any(String),
    });
    for (const extra of [
      { gameId: "game-2" },
      { cameraRole: "camera-away" },
      { nonce: "stale-request" },
      { generation: -1 },
      { unexpected: true },
    ]) {
      f.acknowledge(0, extra);
      await Promise.resolve();
      expect(resolved).not.toHaveBeenCalled();
      expect(f.removeEventListener).not.toHaveBeenCalled();
    }
    f.acknowledge();
    await expect(pending).resolves.toBe(true);
    expect(f.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("keeps simultaneous roles and repeated requests independent", async () => {
    const f = bridge();
    const first = cameraInputNativeConnection(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    const second = cameraInputNativeConnection(
      "game-1",
      "camera-away",
      "disconnect-camera",
    );
    const repeated = cameraInputNativeConnection(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    expect(f.postMessage.mock.calls[0][0].nonce).not.toBe(
      f.postMessage.mock.calls[1][0].nonce,
    );
    const firstResolved = vi.fn();
    const repeatedResolved = vi.fn();
    void first.then(firstResolved);
    void repeated.then(repeatedResolved);
    f.acknowledge(1);
    await expect(second).resolves.toBe(false);
    expect(firstResolved).not.toHaveBeenCalled();
    f.acknowledge(0);
    await expect(first).resolves.toBe(true);
    expect(repeatedResolved).not.toHaveBeenCalled();
    f.acknowledge(2);
    await expect(repeated).resolves.toBe(true);
  });

  it.each([
    { ok: false, error: "Camera is unavailable." },
    { connectionEnabled: false },
  ])("rejects an unsuccessful or opposite-intent receipt", async (extra) => {
    const f = bridge();
    const pending = cameraInputNativeConnection(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    const assertion = expect(pending).rejects.toThrow(
      extra.error ?? "Studio could not confirm",
    );
    f.acknowledge(0, extra);
    await assertion;
    expect(f.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("rejects missing/throwing bridges and times out without a scoped receipt", async () => {
    vi.stubGlobal("window", {});
    await expect(
      cameraInputNativeConnection("game-1", "camera-home", "connect-camera"),
    ).rejects.toThrow("Open this game in Studio");
    const f = bridge();
    f.postMessage.mockImplementationOnce(() => {
      throw Error("bridge closed");
    });
    await expect(
      cameraInputNativeConnection("game-1", "camera-home", "connect-camera"),
    ).rejects.toThrow("Windows Studio is unavailable");
    expect(f.removeEventListener).toHaveBeenCalledTimes(1);
    vi.useFakeTimers();
    bridge();
    const pending = cameraInputNativeConnection(
      "game-1",
      "camera-home",
      "connect-camera",
    );
    const assertion = expect(pending).rejects.toThrow(
      "Studio did not confirm the camera connection",
    );
    await vi.advanceTimersByTimeAsync(12000);
    await assertion;
  });
});
