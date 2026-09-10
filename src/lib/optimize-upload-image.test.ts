import { afterEach, describe, expect, it, vi } from "vitest";
import {
  optimizeUploadImage,
  uploadImageDimensions,
} from "./optimize-upload-image";

const originalDocument = globalThis.document;
const originalCreateImageBitmap = globalThis.createImageBitmap;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "createImageBitmap", {
    configurable: true,
    value: originalCreateImageBitmap,
  });
});

describe("uploadImageDimensions", () => {
  it("preserves aspect ratio, bounds the longest edge, and never upscales", () => {
    expect(uploadImageDimensions(4000, 2000)).toEqual({
      width: 1600,
      height: 800,
    });
    expect(uploadImageDimensions(400, 200, 800)).toEqual({
      width: 400,
      height: 200,
    });
  });
});

describe("optimizeUploadImage", () => {
  it("retries at smaller dimensions, emits a small JPEG, and releases canvas and bitmap", async () => {
    const bitmap = {
      width: 3200,
      height: 1600,
      close: vi.fn(),
    } as unknown as ImageBitmap;
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: vi.fn().mockResolvedValue(bitmap),
    });
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      })),
      toBlob: vi.fn((callback: BlobCallback) => {
        const oversized = canvas.width >= 1600;
        callback(new Blob([new Uint8Array(oversized ? 300_001 : 200_000)]));
      }),
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: vi.fn(() => canvas) },
    });

    const result = await optimizeUploadImage(
      new File(["source"], "rink.png", { type: "image/png" }),
    );

    expect(result.name).toBe("rink.jpg");
    expect(result.type).toBe("image/jpeg");
    expect(result.size).toBeLessThanOrEqual(300_000);
    expect(canvas.toBlob).toHaveBeenCalledTimes(6);
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
  });

  it("returns a friendly error for a file that cannot be decoded", async () => {
    Object.defineProperty(globalThis, "createImageBitmap", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("bad image")),
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: undefined,
    });
    await expect(
      optimizeUploadImage(
        new File(["broken"], "broken.png", { type: "image/png" }),
      ),
    ).rejects.toThrow("Image optimization is unavailable in this browser.");
  });
});
