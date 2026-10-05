import { describe, expect, it, vi } from "vitest";
import { decodeM4CameraImage } from "./m4-camera-image-browser";

describe("bounded camera image decode", () => {
  it("aborts a stalled decode and releases its image even when it completes late", async () => {
    const controller = new AbortController();
    let finish!: () => void;
    const image = {
      src: "blob:pending-camera",
      decode: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    };
    const pending = decodeM4CameraImage(image, controller.signal);
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    expect(image.src).toBe("");
    finish();
    await Promise.resolve();
    expect(image.src).toBe("");
  });
  it("does not start decoding an already-retired source", async () => {
    const controller = new AbortController();
    controller.abort();
    const image = { src: "blob:old-generation", decode: vi.fn(async () => {}) };
    await expect(
      decodeM4CameraImage(image, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(image.decode).not.toHaveBeenCalled();
    expect(image.src).toBe("");
  });
  it("accepts a current decoded frame and detaches its abort listener", async () => {
    const controller = new AbortController();
    const image = { src: "blob:current", decode: vi.fn(async () => {}) };
    await decodeM4CameraImage(image, controller.signal);
    controller.abort();
    expect(image.src).toBe("blob:current");
  });
});
