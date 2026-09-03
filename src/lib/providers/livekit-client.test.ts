import { describe, expect, it, vi } from "vitest";
import { Track } from "livekit-client";
import {
  SingleFlightGate,
  disposeCameraResources,
  isPermissionError,
  isRoleCameraPublication,
  participantCameraRole,
  portraitCameraOptions,
  portraitMediaOptions,
  publishedCameraTracks,
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
    expect(portraitCameraOptions).toEqual({
      facingMode: "environment",
      resolution: { width: 720, height: 1280, frameRate: 30 },
      frameRate: 30,
    });
    expect(portraitMediaOptions).toEqual({
      audio: false,
      video: portraitCameraOptions,
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
