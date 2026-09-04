import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeSponsor } from "./DecodedSponsorImage";

afterEach(() => vi.unstubAllGlobals());

describe("sponsor decoding", () => {
  it("waits for decode before resolving", async () => {
    let finish!: () => void;
    class FakeImage {
      src = "";
      decode = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    }
    vi.stubGlobal("Image", FakeImage);
    let ready = false;
    const pending = decodeSponsor("/wide.webp").then(() => (ready = true));
    await Promise.resolve();
    expect(ready).toBe(false);
    finish();
    await pending;
    expect(ready).toBe(true);
  });

  it("rejects a failed image so the carousel can skip it", async () => {
    class BrokenImage {
      src = "";
      decode = () => Promise.reject(new Error("broken"));
    }
    vi.stubGlobal("Image", BrokenImage);
    await expect(decodeSponsor("/broken.webp")).rejects.toThrow("broken");
  });
});
