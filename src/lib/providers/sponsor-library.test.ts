import { describe, expect, it } from "vitest";
import { inspectSponsorImage, MAX_SPONSOR_BYTES } from "./sponsor-library";

describe("sponsor image inspection", () => {
  it.each([
    ["image/jpeg", [0xff, 0xd8, 0xff]],
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/webp", [...Buffer.from("RIFF0000WEBP")]],
  ])("accepts valid %s magic bytes", (type, signature) => {
    expect(inspectSponsorImage(new Uint8Array(signature), type)).toBe(type);
  });

  it("rejects SVG, mismatched content, empty files, and oversized files", () => {
    expect(() =>
      inspectSponsorImage(
        new Uint8Array(Buffer.from("<svg/>")),
        "image/svg+xml",
      ),
    ).toThrow();
    expect(() =>
      inspectSponsorImage(new Uint8Array([0xff, 0xd8, 0xff]), "image/png"),
    ).toThrow();
    expect(() => inspectSponsorImage(new Uint8Array(), "image/png")).toThrow();
    expect(() =>
      inspectSponsorImage(new Uint8Array(MAX_SPONSOR_BYTES + 1), "image/png"),
    ).toThrow();
  });
});
