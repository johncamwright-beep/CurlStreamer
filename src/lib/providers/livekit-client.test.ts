import { describe, expect, it, vi } from "vitest";
import { Track } from "livekit-client";
import {
  SingleFlightGate,
  acquireVerifiedPortraitCamera,
  cameraCapabilityError,
  cameraPermissionGuidance,
  deviceIsPortrait,
  disposeCameraResources,
  isPermissionError,
  isRoleCameraPublication,
  participantCameraRole,
  portraitMediaConstraints,
  publishedCameraTracks,
  sourcePresentation,
  supportedPortraitConstraints,
  verifyPortraitTrack,
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

  it("uses device orientation before the viewport fallback", () => {
    expect(deviceIsPortrait({ type: "portrait-primary" }, 900, 500)).toBe(true);
    expect(deviceIsPortrait({ type: "landscape-primary" }, 500, 900)).toBe(
      false,
    );
    expect(deviceIsPortrait(undefined, 500, 900)).toBe(true);
  });

  it("contains every source and letterboxes landscape video", () => {
    expect(sourcePresentation(720, 1280)).toEqual({
      fit: "contain",
      description: "portrait source",
    });
    expect(sourcePresentation(1920, 1080)).toEqual({
      fit: "contain",
      description: "landscape source · letterboxed",
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

  it("makes exactly one acquisition call per attempt", async () => {
    const getUserMedia = vi
      .fn()
      .mockResolvedValue({ getVideoTracks: () => [] });
    await expect(
      acquireVerifiedPortraitCamera(
        { getUserMedia } as never,
        {} as HTMLVideoElement,
        true,
      ),
    ).rejects.toMatchObject({ name: "NotFoundError" });
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it("builds supported native portrait constraints", () => {
    expect(
      supportedPortraitConstraints({
        width: { min: 320, max: 1920 },
        height: { min: 240, max: 1920 },
        aspectRatio: { min: 0.5, max: 2 },
      }),
    ).toMatchObject({
      width: { ideal: 720, max: 720 },
      height: { ideal: 1280, min: 1280 },
      aspectRatio: { exact: 9 / 16 },
    });
  });

  it("applies portrait constraints to the same landscape track and verifies metadata", async () => {
    let settings = { width: 1280, height: 720 };
    const video = {
      readyState: 1,
      videoWidth: 1280,
      videoHeight: 720,
      requestVideoFrameCallback(callback: () => void) {
        this.videoWidth = 720;
        this.videoHeight = 1280;
        callback();
        return 1;
      },
    };
    const track = {
      getSettings: vi.fn(() => settings),
      getCapabilities: vi.fn(() => ({
        width: { min: 320, max: 1920 },
        height: { min: 240, max: 1920 },
        aspectRatio: { min: 0.5, max: 2 },
      })),
      applyConstraints: vi.fn(async () => {
        settings = { width: 720, height: 1280 };
      }),
    };
    const report = await verifyPortraitTrack(
      track as never,
      video as never,
      true,
    );
    expect(track.applyConstraints).toHaveBeenCalledOnce();
    expect(report).toMatchObject({
      trackWidth: 720,
      trackHeight: 1280,
      videoWidth: 720,
      videoHeight: 1280,
      portrait: true,
      constraintsApplied: true,
    });
  });

  it("accurately warns when landscape frames cannot become portrait", async () => {
    const track = {
      getSettings: () => ({ width: 1920, height: 1080 }),
      getCapabilities: () => ({
        width: { min: 320, max: 1920 },
        height: { min: 240, max: 1080 },
      }),
      applyConstraints: vi.fn(),
    };
    const report = await verifyPortraitTrack(
      track as never,
      { readyState: 1, videoWidth: 1920, videoHeight: 1080 } as never,
      true,
    );
    expect(track.applyConstraints).not.toHaveBeenCalled();
    expect(report.portrait).toBe(false);
    expect(report.warning).toContain("complete landscape video");
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
