import { describe, expect, it } from "vitest";
import { validateSponsorImage } from "./sponsor-library";

describe("sponsor image validation", () => {
  it("accepts a matching PNG signature", async () => {
    const file = new File(
      [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
      "logo.png",
      { type: "image/png" },
    );
    await expect(validateSponsorImage(file)).resolves.toMatchObject({
      mime: "image/png",
      extension: "png",
    });
  });
  it("rejects spoofed MIME content", async () => {
    const file = new File(["not an image"], "logo.png", { type: "image/png" });
    await expect(validateSponsorImage(file)).rejects.toThrow("genuine JPEG");
  });
  it("rejects files over 12 MB before writes", async () => {
    const file = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(validateSponsorImage(file)).rejects.toThrow("12 MB");
  });
});
