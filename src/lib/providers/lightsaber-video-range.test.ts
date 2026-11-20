import { describe, it, expect } from "vitest";
import { lightsaberByteRange } from "./lightsaber-video-range";
describe("native Lightsaber video ranges", () => {
  it("supports full, bounded, open and suffix ranges", () => {
    expect(lightsaberByteRange(undefined, 100)).toBeUndefined();
    expect(lightsaberByteRange("bytes=10-19", 100)).toEqual({
      start: 10,
      end: 19,
    });
    expect(lightsaberByteRange("bytes=90-", 100)).toEqual({
      start: 90,
      end: 99,
    });
    expect(lightsaberByteRange("bytes=-10", 100)).toEqual({
      start: 90,
      end: 99,
    });
    expect(lightsaberByteRange("bytes=90-200", 100)).toEqual({
      start: 90,
      end: 99,
    });
  });
  it.each([
    "bytes=100-",
    "bytes=20-10",
    "bytes=-0",
    "bytes=0-1,5-6",
    "bytes=",
    "anything",
    "bytes=9007199254740993-",
  ])("rejects invalid range %s", (header) => {
    expect(lightsaberByteRange(header, 100)).toBeNull();
  });
});
