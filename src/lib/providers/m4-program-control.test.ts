import { describe, expect, it } from "vitest";
import { readM4ProgramControlAck } from "./m4-studio-recorder";
function ack(tag: string, id: number, length = 8) {
  const bytes = Buffer.alloc(length);
  bytes.write(tag);
  bytes.writeUInt32LE(id, 4);
  return bytes;
}
describe("native program control acknowledgment protocol", () => {
  it("classifies a matching negative refresh as usable protocol followed by health and refresh", () => {
    expect(readM4ProgramControlAck("RFR1", 1, ack("RFF1", 1))).toBe("rejected");
    expect(readM4ProgramControlAck("RFS1", 2, ack("RFP1", 2, 24))).toBe(
      "accepted",
    );
    expect(readM4ProgramControlAck("RFR1", 3, ack("RFA1", 3))).toBe("accepted");
  });
  it("rejects mismatched IDs, negative health, unknown tags and invalid lengths", () => {
    for (const value of [
      ack("RFF1", 2),
      ack("XXXX", 1),
      ack("RFA1", 1, 24),
      Buffer.alloc(0),
    ])
      expect(() => readM4ProgramControlAck("RFR1", 1, value)).toThrow(
        "m4_recording_unavailable",
      );
    expect(() =>
      readM4ProgramControlAck("RFS1", 1, ack("RFF1", 1, 24)),
    ).toThrow("m4_recording_unavailable");
  });
});
