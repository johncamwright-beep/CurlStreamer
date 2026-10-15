import { describe, expect, it } from "vitest";
import { createM4UsbAudioQueue } from "./m4-usb-audio";

const pcm = (samples: number, value = 0.25) => {
  const valueBuffer = Buffer.alloc(samples * Float32Array.BYTES_PER_ELEMENT);
  for (let offset = 0; offset < valueBuffer.length; offset += 4)
    valueBuffer.writeFloatLE(value, offset);
  return valueBuffer;
};

describe("M4 USB audio queue", () => {
  it("keeps at most half a second and drops oldest complete chunks", () => {
    const queue = createM4UsbAudioQueue();
    queue.push(pcm(12_000, 0.1));
    queue.push(pcm(12_000, 0.2));
    queue.push(pcm(12_000, 0.3));
    const drained = queue.drain();
    expect(drained.pcm.length).toBe(24_000 * 4);
    expect(drained.pcm.readFloatLE(0)).toBeCloseTo(0.2);
    expect(drained.pcm.readFloatLE(drained.pcm.length - 4)).toBeCloseTo(0.3);
  });

  it("rejects malformed/non-finite PCM and increments generation on flush", () => {
    const queue = createM4UsbAudioQueue();
    expect(() => queue.push(Buffer.from([0, 1, 2]))).toThrow("invalid_pcm");
    expect(() => queue.push(pcm(1, Number.NaN))).toThrow("invalid_pcm");
    queue.push(pcm(1));
    const before = queue.drain().generation;
    queue.push(Buffer.alloc(0));
    expect(queue.drain()).toEqual({
      generation: before + 1,
      pcm: Buffer.alloc(0),
    });
  });
});
