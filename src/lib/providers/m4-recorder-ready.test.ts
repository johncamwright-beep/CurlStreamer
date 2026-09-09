import { PassThrough, Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readM4RecorderReady } from "./m4-recorder-ready";

function frame() {
  const result = Buffer.alloc(302);
  result.write("READY\n");
  result.writeUInt32LE(0x4d344253, 6);
  result.writeUInt16LE(1, 10);
  result.write("\\\\.\\pipe\\curlstreamer-m4-recorder-test", 14, "utf16le");
  result.fill(79, 270);
  return result;
}
describe("recorder private readiness channel", () => {
  it("consumes fragmented readiness and bootstrap, wiping received bytes", async () => {
    const message = frame();
    const chunks = Array.from(message, (byte) => Buffer.from([byte]));
    const result = await readM4RecorderReady(Readable.from(chunks), true);
    expect(result?.pipe).toBe("\\\\.\\pipe\\curlstreamer-m4-recorder-test");
    expect(result?.capability).toEqual(Buffer.alloc(32, 79));
    expect(chunks.every((chunk) => chunk.every((byte) => byte === 0))).toBe(
      true,
    );
    result?.capability.fill(0);
  });
  it("accepts the existing recording-only readiness without a stream channel", async () => {
    await expect(
      readM4RecorderReady(Readable.from([Buffer.from("READY\n")]), false),
    ).resolves.toBeUndefined();
  });
  it("rejects missing, extra, unexpected and invalid bootstrap bytes", async () => {
    const invalid = frame();
    invalid[10] = 2;
    for (const [bytes, streaming] of [
      [Buffer.from("READY\n"), true],
      [Buffer.concat([frame(), Buffer.from([1])]), true],
      [frame(), false],
      [invalid, true],
      [Buffer.from("FAILED"), false],
    ] as const) {
      await expect(
        readM4RecorderReady(Readable.from([bytes]), streaming),
      ).rejects.toThrow("m4_recording_unavailable");
      expect(bytes.every((byte) => byte === 0)).toBe(true);
    }
  });
  it("bounds a stalled startup and destroys its inherited channel", async () => {
    const pipe = new PassThrough();
    const reading = readM4RecorderReady(pipe, true, 20);
    pipe.write(Buffer.from("READY\n"));
    await expect(reading).rejects.toThrow("m4_recording_unavailable");
    expect(pipe.destroyed).toBe(true);
  });
});
