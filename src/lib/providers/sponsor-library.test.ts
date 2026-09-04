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
  it.each(["image/png", "image/x-png", ""])(
    "normalizes PNG bytes reported as %s",
    async (type) => {
      const file = new File(
        [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
        "team.png",
        { type },
      );
      await expect(validateSponsorImage(file)).resolves.toMatchObject({
        mime: "image/png",
      });
    },
  );
  it("rejects spoofed MIME content", async () => {
    const file = new File(["not an image"], "logo.png", { type: "image/png" });
    await expect(validateSponsorImage(file)).rejects.toThrow("logo.png");
  });
  it("rejects files over the deployed request limit before writes", async () => {
    const file = new File([new Uint8Array(12 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(validateSponsorImage(file)).rejects.toThrow("4 MB");
  });
});
