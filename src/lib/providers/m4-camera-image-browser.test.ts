import { describe, expect, it, vi } from "vitest";
import { decodeM4CameraBitmap } from "./m4-camera-image-browser";
const blob = new Blob(["frame"]);
describe("bounded camera bitmap decode", () => {
  it("aborts a stalled decode and closes its late bitmap exactly once", async () => {
    const controller = new AbortController();
    let finish!: (bitmap: ImageBitmap) => void;
    const decode = vi.fn(
      () =>
        new Promise<ImageBitmap>((resolve) => {
          finish = resolve;
        }),
    );
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const pending = decodeM4CameraBitmap(blob, controller.signal, decode);
    await Promise.resolve();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    finish(bitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
    controller.abort();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
  it("does not decode an already-retired source", async () => {
    const controller = new AbortController();
    controller.abort();
    const decode = vi.fn();
    await expect(
      decodeM4CameraBitmap(blob, controller.signal, decode),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(decode).not.toHaveBeenCalled();
  });
  it("transfers current bitmap ownership and detaches cancellation", async () => {
    const controller = new AbortController();
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    expect(
      await decodeM4CameraBitmap(blob, controller.signal, async () => bitmap),
    ).toBe(bitmap);
    controller.abort();
    expect(bitmap.close).not.toHaveBeenCalled();
    bitmap.close();
    expect(bitmap.close).toHaveBeenCalledTimes(1);
  });
  it("rejects undecodable frames and safely consumes late failures", async () => {
    const controller = new AbortController();
    await expect(
      decodeM4CameraBitmap(blob, controller.signal, async () => {
        throw new Error("bad JPEG");
      }),
    ).rejects.toThrow("bad JPEG");
    let fail!: (error: Error) => void;
    const pending = decodeM4CameraBitmap(
      blob,
      controller.signal,
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    await Promise.resolve();
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    controller.abort();
    await rejected;
    fail(new Error("late failure"));
    await Promise.resolve();
  });
});
