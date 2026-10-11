import { describe, expect, it } from "vitest";
import { programSyncDelays } from "./program-sync";

describe("signed program synchronization", () => {
  it.each([undefined, NaN, Infinity, -Infinity])(
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
