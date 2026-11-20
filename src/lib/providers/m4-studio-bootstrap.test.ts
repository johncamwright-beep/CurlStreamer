import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { readM4StudioBootstrap } from "./m4-studio-bootstrap";

const pipe = "\\\\.\\pipe\\curlstreamer-m4-bootstrap-test";
function packet() {
  const bytes = Buffer.alloc(296);
  bytes.writeUInt32LE(0x4d344253, 0);
  bytes.writeUInt16LE(1, 4);
  bytes.write(pipe, 8, "utf16le");
  bytes.fill(73, 264);
  return bytes;
}
const wiped = (buffer: Buffer) => buffer.every((byte) => byte === 0);

describe("production Studio inherited bootstrap", () => {
  it("accepts fragmented input only at EOF and transfers a private capability copy", async () => {
    const input = new PassThrough();
    const result = readM4StudioBootstrap(input);
    const first = packet().subarray(0, 279);
    const second = packet().subarray(279);
    let complete = false;
    void result.then(() => {
      complete = true;
    });
    input.write(first);
    input.write(second);
    await Promise.resolve();
    expect(complete).toBe(false);
    input.end();
    const bootstrap = await result;
    expect(bootstrap.pipe).toBe(pipe);
    expect(bootstrap.capability.equals(Buffer.alloc(32, 73))).toBe(true);
    expect(wiped(first)).toBe(true);
    expect(wiped(second)).toBe(true);
    bootstrap.capability.fill(0);
  });

  it.each([
    "magic",
    "version",
    "reserved",
    "padding",
    "namespace",
    "zero_capability",
    "unterminated",
  ])("rejects %s and wipes all received bytes", async (kind) => {
    const input = new PassThrough();
    const result = readM4StudioBootstrap(input);
    const bytes = packet();
    if (kind === "magic") bytes.writeUInt32LE(0, 0);
    if (kind === "version") bytes.writeUInt16LE(2, 4);
    if (kind === "reserved") bytes.writeUInt16LE(1, 6);
    if (kind === "padding") bytes[262] = 1;
    if (kind === "namespace") bytes.write("evil", 8, "utf16le");
    if (kind === "zero_capability") bytes.fill(0, 264);
    if (kind === "unterminated") bytes.fill(65, 8, 264);
    input.end(bytes);
    await expect(result).rejects.toThrow("m4_studio_bootstrap_unavailable");
    expect(wiped(bytes)).toBe(true);
    expect(input.destroyed).toBe(true);
  });

  it.each(["truncated", "extra_same_chunk", "extra_later_chunk"])(
    "rejects %s instead of accepting an ambiguous frame",
    async (kind) => {
      const input = new PassThrough();
      const result = readM4StudioBootstrap(input);
      const bytes =
        kind === "truncated"
          ? packet().subarray(0, 290)
          : kind === "extra_same_chunk"
            ? Buffer.concat([packet(), Buffer.from([9])])
            : packet();
      input.write(bytes);
      const extra = Buffer.from([9]);
      if (kind === "extra_later_chunk") input.write(extra);
      if (!input.destroyed) input.end();
      await expect(result).rejects.toThrow("m4_studio_bootstrap_unavailable");
      expect(wiped(bytes)).toBe(true);
      if (kind === "extra_later_chunk") expect(wiped(extra)).toBe(true);
    },
  );

  it("bounds a stalled bootstrap even when all bytes arrived without EOF", async () => {
    const input = new PassThrough();
    const result = readM4StudioBootstrap(input, 20);
    const bytes = packet();
    input.write(bytes);
    await expect(result).rejects.toThrow("m4_studio_bootstrap_unavailable");
    expect(wiped(bytes)).toBe(true);
    expect(input.destroyed).toBe(true);
  });

  it.each(["close", "error"])(
    "fails safely on premature %s without exposing stream errors",
    async (kind) => {
      const input = new PassThrough();
      const result = readM4StudioBootstrap(input);
      const bytes = packet().subarray(0, 280);
      input.write(bytes);
      if (kind === "error") input.destroy(new Error("private launcher detail"));
      else input.destroy();
      await expect(result).rejects.toThrow(/^m4_studio_bootstrap_unavailable$/);
      expect(wiped(bytes)).toBe(true);
    },
  );

  it("rejects decoded string streams instead of accepting unwipeable capability strings", async () => {
    const input = new PassThrough();
    input.setEncoding("utf8");
    const result = readM4StudioBootstrap(input);
    input.end(packet());
    await expect(result).rejects.toThrow("m4_studio_bootstrap_unavailable");
  });
});
