import { describe, expect, it, vi } from "vitest";
import {
  cameraInputNativeAction,
  studioCameraInputSchema,
} from "./StudioCameraInputs";

describe("native camera source boundary", () => {
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
});
