import { expect, it, vi } from "vitest";
import { acquireRawPortraitCamera } from "./camera-capture";

it("reports native landscape output honestly without forcing portrait constraints", async () => {
  const track = {
    getSettings: () => ({ width: 1280, height: 720 }),
    getCapabilities: vi.fn(),
    applyConstraints: vi.fn(),
    stop: vi.fn(),
  };
  const stream = { getVideoTracks: () => [track] };
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const video = {
    readyState: 1,
    videoWidth: 1280,
    videoHeight: 720,
    srcObject: null,
  };
  const result = await acquireRawPortraitCamera(
    { getUserMedia },
    video as unknown as HTMLVideoElement,
    true,
    undefined,
    "native",
  );
  const constraints = getUserMedia.mock.calls[0][0];
  expect(constraints.audio).toBe(false);
  for (const key of ["width", "height", "aspectRatio"])
    expect(constraints.video).not.toHaveProperty(key);
  expect(track.applyConstraints).not.toHaveBeenCalled();
  expect(result.report).toMatchObject({
    captureMode: "native",
    portrait: false,
    constraintsApplied: false,
    trackWidth: 1280,
    trackHeight: 720,
  });
  expect(video.srcObject).toBe(stream);
});
