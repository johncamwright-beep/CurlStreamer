import { expect, it } from "vitest";
import { replayRange } from "./studio-replay-range";
import { readM4ProgramControlAck } from "./m4-studio-recorder";
import { readM4RecorderReady } from "./m4-recorder-ready";
import { Readable } from "node:stream";

it("serves bounded full, suffix and seek ranges, rejecting malformed/outside ranges", () => {
  expect(replayRange(undefined, 100)).toEqual({
    start: 0,
    end: 99,
    partial: false,
  });
  expect(replayRange("bytes=20-200", 100)).toEqual({
    start: 20,
    end: 99,
    partial: true,
  });
  expect(replayRange("bytes=-10", 100)).toEqual({
    start: 90,
    end: 99,
    partial: true,
  });
  expect(replayRange("bytes=90-", 100)).toEqual({
    start: 90,
    end: 99,
    partial: true,
  });
  for (const range of [
    "bytes=100-",
    "bytes=40-20",
    "bytes=-0",
    "bytes=1-2,4-5",
    "bytes=-",
    "bytes=9999999999999999999-",
  ])
    expect(replayRange(range, 100)).toBeNull();
});
it("requires explicit native replay capability proof", async () => {
  const frame = Buffer.from([
    82, 69, 65, 68, 89, 10, 80, 67, 86, 49, 1, 0, 0, 0, 82, 80, 86, 49, 1, 0, 0,
    0,
  ]);
  await expect(
    readM4RecorderReady(
      Readable.from([Buffer.from(frame)]),
      false,
      100,
      false,
      true,
      true,
    ),
  ).resolves.toBeUndefined();
  await expect(
    readM4RecorderReady(
      Readable.from([frame.subarray(0, 14)]),
      false,
      100,
      false,
      true,
      true,
    ),
  ).rejects.toThrow();
});
it("correlates replay status and rejects mismatched acknowledgements", () => {
  const ack = Buffer.alloc(24);
  ack.write("RPT1");
  ack.writeUInt32LE(42, 4);
  expect(readM4ProgramControlAck("RPS1", 42, ack)).toBe("accepted");
  expect(() => readM4ProgramControlAck("RPS1", 43, ack)).toThrow();
  expect(() =>
    readM4ProgramControlAck("RPS1", 42, ack.subarray(0, 8)),
  ).toThrow();
  const rejection = Buffer.alloc(8);
  rejection.write("RFF1");
  rejection.writeUInt32LE(42, 4);
  expect(readM4ProgramControlAck("RPP1", 42, rejection)).toBe("rejected");
});
