import { describe, expect, it, vi } from "vitest";
import { Track } from "livekit-client";
import {
  SingleFlightGate,
  recoverCameraPermission,
  cameraCapabilityError,
  cameraPermissionGuidance,
  disposeCameraResources,
  isPermissionError,
  isRoleCameraPublication,
  participantCameraRole,
  portraitMediaConstraints,
  publishedCameraTracks,
  sourcePresentation,
} from "./livekit-client";

describe("LiveKit camera client", () => {
  it("rejects duplicate connection attempts until the first finishes", () => {
    const gate = new SingleFlightGate();
    expect(gate.enter()).toBe(true);
    expect(gate.enter()).toBe(false);
    gate.leave();
    expect(gate.enter()).toBe(true);
  });

  it("requests a rear-facing 720x1280 30 fps portrait track", () => {
    expect(portraitMediaConstraints).toEqual({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 720 },
        height: { ideal: 1280 },
        aspectRatio: { ideal: 9 / 16 },
        frameRate: { ideal: 30 },
      },
    });
  });

  it("contains portrait sources and uses a centered crop only for landscape", () => {
    expect(sourcePresentation(720, 1280)).toEqual({
      fit: "contain",
      description: "portrait source",
    });
    expect(sourcePresentation(1920, 1080)).toEqual({
      fit: "cover",
      description: "cropped landscape fallback",
    });
  });

  it("only classifies actual browser permission errors as denial", () => {
    expect(
      isPermissionError(new DOMException("denied", "NotAllowedError")),
    ).toBe(true);
    expect(isPermissionError(new Error("token rejected"))).toBe(false);
    expect(
      isPermissionError(new DOMException("busy", "NotReadableError")),
    ).toBe(false);
  });

  it("detects camera support by capability rather than browser name", () => {
    const supported = {
      mediaDevices: { getUserMedia: vi.fn() },
    } as unknown as Pick<Navigator, "mediaDevices">;
    expect(cameraCapabilityError(supported, true)).toBeUndefined();
    expect(cameraCapabilityError(supported, false)).toContain("HTTPS");
    expect(
      cameraCapabilityError({ mediaDevices: undefined } as never, true),
    ).toContain("does not provide camera capture");
  });

  it("provides permission recovery for iOS Chrome, Safari, and Android Chrome", () => {
    expect(cameraPermissionGuidance("iPhone CriOS/140.0")).toContain(
      "Apps > Chrome > Camera",
    );
    expect(
      cameraPermissionGuidance("iPhone Version/18 Mobile Safari"),
    ).toContain("Apps > Safari > Camera");
    expect(cameraPermissionGuidance("Android 15 Chrome/140.0")).toContain(
      "Apps > Chrome > Permissions > Camera",
    );
  });

  it("retries once when Chrome reports denial after permission became granted", async () => {
    const camera = { id: "camera" };
    const acquire = vi
      .fn<() => Promise<typeof camera>>()
      .mockRejectedValueOnce(new DOMException("stale", "NotAllowedError"))
      .mockResolvedValueOnce(camera);
    const query = vi.fn().mockResolvedValue({ state: "granted" });
    const statuses: string[] = [];
    await expect(
      recoverCameraPermission(acquire, { query } as never, (status) =>
        statuses.push(status),
      ),
    ).resolves.toBe(camera);
    expect(acquire).toHaveBeenCalledTimes(2);
    expect(statuses).toEqual(["waiting", "starting"]);
  });

  it("does not loop when the single permission recovery also fails", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const acquire = vi.fn().mockRejectedValue(denied);
    await expect(
      recoverCameraPermission(acquire, {
        query: vi.fn().mockResolvedValue({ state: "granted" }),
      } as never),
    ).rejects.toBe(denied);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("preserves a genuine denied permission without retrying", async () => {
    const denied = new DOMException("denied", "NotAllowedError");
    const acquire = vi.fn().mockRejectedValue(denied);
    await expect(
      recoverCameraPermission(acquire, {
        query: vi.fn().mockResolvedValue({ state: "denied" }),
      } as never),
    ).rejects.toBe(denied);
    expect(acquire).toHaveBeenCalledOnce();
  });

  it("unpublishes, detaches, and stops an old track before retry", async () => {
    const calls: string[] = [];
    const track = {
      detach: vi.fn(() => calls.push("detach")),
      stop: vi.fn(() => calls.push("stop")),
    };
    const participant = {
      unpublishTrack: vi.fn(async () => {
        calls.push("unpublish");
      }),
    };
    await disposeCameraResources(participant as never, track as never);
    expect(calls).toEqual(["unpublish", "detach", "stop"]);
  });

  it("maps only trusted token metadata to Home and Away camera roles", () => {
    expect(
      participantCameraRole({
        metadata: '{"cameraRole":"camera-home"}',
      } as never),
    ).toBe("camera-home");
    expect(
      participantCameraRole({
        metadata: '{"cameraRole":"camera-away"}',
      } as never),
    ).toBe("camera-away");
    expect(
      participantCameraRole({ metadata: '{"cameraRole":"admin"}' } as never),
    ).toBeUndefined();
    expect(
      participantCameraRole({ metadata: "not-json" } as never),
    ).toBeUndefined();
  });

  it("selects existing camera publications and validates new subscriptions by role", () => {
    const cameraTrack = { id: "camera" };
    const publications = [
      {
        source: Track.Source.Camera,
        kind: Track.Kind.Video,
        track: cameraTrack,
      },
      {
        source: Track.Source.Microphone,
        kind: Track.Kind.Audio,
        track: { id: "audio" },
      },
    ];
    expect(
      publishedCameraTracks({
        getTrackPublications: () => publications,
      } as never),
    ).toEqual([cameraTrack]);
    expect(
      isRoleCameraPublication(
        "camera-home",
        { metadata: '{"cameraRole":"camera-home"}' } as never,
        publications[0] as never,
      ),
    ).toBe(true);
    expect(
      isRoleCameraPublication(
        "camera-away",
        { metadata: '{"cameraRole":"camera-home"}' } as never,
        publications[0] as never,
      ),
    ).toBe(false);
  });
});
