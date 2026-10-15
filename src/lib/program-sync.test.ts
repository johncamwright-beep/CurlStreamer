import { describe, expect, it } from "vitest";
import { programSyncDelays } from "./program-sync";

describe("signed program synchronization", () => {
  it("defaults to 1.5 seconds of camera delay and preserves explicit zero", () => {
    expect(programSyncDelays(undefined)).toEqual({
      microphoneDelayMs: 0,
      cameraDelayMs: 1500,
    });
    expect(programSyncDelays(0)).toEqual({
      microphoneDelayMs: 0,
      cameraDelayMs: 0,
    });
  });
  it.each([NaN, Infinity, -Infinity])(
    "leaves playback unchanged for invalid adjustment %s",
    (adjustment) => {
      expect(programSyncDelays(adjustment)).toEqual({
        microphoneDelayMs: 0,
        cameraDelayMs: 0,
      });
    },
  );
  it("keeps audio nodes and video queues within their supported delay", () => {
    expect(programSyncDelays(-6000)).toEqual({
      microphoneDelayMs: 0,
      cameraDelayMs: 5000,
    });
    expect(programSyncDelays(6000)).toEqual({
      microphoneDelayMs: 5000,
      cameraDelayMs: 0,
    });
  });
});
