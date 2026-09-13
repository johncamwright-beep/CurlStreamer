import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { randomBytes } from "node:crypto";
import { normalizeUploadImage } from "./upload-image";

describe("server upload normalization", () => {
  it("compresses a noisy portrait below 300 kB without cropping and removes metadata", async () => {
    const input = await sharp(randomBytes(1200 * 1800 * 3), {
      raw: { width: 1200, height: 1800, channels: 3 },
    })
      .jpeg({ quality: 95 })
      .withExif({ IFD0: { Artist: "private metadata" } })
      .toBuffer();
    const result = await normalizeUploadImage(input);
    const metadata = await sharp(result.bytes).metadata();
    expect(result.bytes.length).toBeLessThan(300_000);
    expect(result.mime).toBe("image/jpeg");
    expect(metadata.height).toBeLessThanOrEqual(1600);
    expect(metadata.width! / metadata.height!).toBeCloseTo(2 / 3, 2);
    expect(metadata.exif).toBeUndefined();
  });
  it("preserves transparent logo pixels", async () => {
    const input = await sharp({
      create: { width: 40, height: 20, channels: 4, background: "#00ffff00" },
    })
      .png()
      .toBuffer();
    const result = await normalizeUploadImage(input);
    expect(result.bytes.length).toBeLessThan(300_000);
    expect((await sharp(result.bytes).metadata()).hasAlpha).toBe(true);
    const pixels = await sharp(result.bytes).raw().toBuffer();
    expect(pixels[3]).toBe(0);
  });
  it("rejects a forged PNG header", async () => {
    await expect(
      normalizeUploadImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])),
    ).rejects.toThrow();
  });
  it("rejects excessive decoded pixel counts before decoding", async () => {
    const input = await sharp({
      create: { width: 6500, height: 6500, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(normalizeUploadImage(input)).rejects.toThrow(/pixel limit/i);
  });
});
