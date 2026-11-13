import { describe, expect, it, vi } from "vitest";
import {
  cameraInputNativeAction,
  cameraInputNativeZoom,
  studioCameraInputSchema,
} from "./StudioCameraInputs";

describe("native camera source boundary", () => {
  it("rejects a missing bridge and an unconfirmed command within a bounded wait", async () => {
    vi.stubGlobal("window", {});
    await expect(
      cameraInputNativeZoom("game-1", "camera-home", 2, 1.2),
    ).rejects.toThrow("Open this game in Studio");
    const events = new EventTarget();
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      chrome: { webview: { postMessage: vi.fn() } },
    });
    vi.useFakeTimers();
    try {
      const promise = cameraInputNativeZoom("game-1", "camera-home", 2, 1.2);
      const assertion = expect(promise).rejects.toThrow(
        "Studio did not confirm IP camera zoom",
      );
      await vi.advanceTimersByTimeAsync(8000);
      await assertion;
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
  it("bounds generation and optional zoom without exposing connection details", () => {
    const snapshot = {
      kind: "rtsp",
      configured: true,
      phase: "streaming",
      generation: 2,
    };
    expect(studioCameraInputSchema.parse(snapshot).zoom).toBeUndefined();
    for (const extra of [
      { generation: -1 },
      { generation: 1.5 },
      { zoom: 0 },
      { zoom: 4.1 },
    ])
      expect(
        studioCameraInputSchema.safeParse({ ...snapshot, ...extra }).success,
      ).toBe(false);
  });
  it("matches scoped acknowledgments and hides native rejection details", async () => {
    const events = new EventTarget();
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("window", {
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      chrome: {
        webview: {
          postMessage: (message: unknown) => {
            sent = message as Record<string, unknown>;
          },
        },
      },
    });
    try {
      const promise = cameraInputNativeZoom("game-1", "camera-home", 2, 1.2);
      const ack = (extra: object) => {
        const event = new Event("studio-camera-zoom-result");
        Object.assign(event, {
          detail: {
            gameId: sent.gameId,
            cameraRole: sent.cameraRole,
            generation: sent.generation,
            nonce: sent.nonce,
            ok: true,
            value: 1.2,
            ...extra,
          },
        });
        events.dispatchEvent(event);
      };
      ack({ generation: 1 });
      ack({});
      await expect(promise).resolves.toBe(1.2);
      const rejected = cameraInputNativeZoom("game-1", "camera-home", 2, 1.4);
      ack({ ok: false, error: "rtsp://private-password" });
      await expect(rejected).rejects.toThrow(
        "Could not change IP camera zoom. Try again.",
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("accepts safe media facts and rejects credentials", () => {
    const snapshot = {
      kind: "tapo",
      host: "192.168.1.2",
      stream: "stream1",
      rotation: 90,
      configured: true,
      phase: "connecting",
      errorCode: null,
      generation: 2,
    };
    expect(studioCameraInputSchema.safeParse(snapshot).success).toBe(true);
    expect(
      studioCameraInputSchema.safeParse({ ...snapshot, password: "secret" })
        .success,
    ).toBe(false);
    expect(
      studioCameraInputSchema.safeParse({ ...snapshot, rotation: 45 }).success,
    ).toBe(false);
  });
  it("sends only a scoped settings action without camera configuration", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("window", { chrome: { webview: { postMessage } } });
    try {
      cameraInputNativeAction("game-1", "camera-away", "configure-camera");
      expect(postMessage).toHaveBeenCalledWith({
        action: "configure-camera",
        gameId: "game-1",
        cameraRole: "camera-away",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("accepts generic IP status but rejects its private connection details", () => {
    const snapshot = {
      kind: "rtsp",
      host: null,
      stream: null,
      rotation: 0,
      configured: true,
      phase: "streaming",
      errorCode: null,
      generation: 5,
    };
    expect(studioCameraInputSchema.safeParse(snapshot).success).toBe(true);
    for (const extra of [
      { path: "/live?password=secret" },
      { url: "rtsp://user:secret@192.168.1.2/live" },
      { username: "user" },
    ]) {
      expect(
        studioCameraInputSchema.safeParse({ ...snapshot, ...extra }).success,
      ).toBe(false);
    }
  });
});
