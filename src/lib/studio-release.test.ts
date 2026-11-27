import { describe, expect, it } from "vitest";
import { studioRelease, formatBytes } from "./studio-release";

describe("studioRelease", () => {
  it("publishes only versioned GitHub assets with usable integrity metadata", () => {
    if (studioRelease.availability === "unpublished") {
      expect("installer" in studioRelease).toBe(false);
      return;
    }
    const asset = studioRelease.installer;
    const url = new URL(asset.url);
    expect(url.protocol).toBe("https:");
    expect(url.host).toBe("github.com");
    expect(url.pathname).toBe(
      "/johncamwright-beep/CurlStreamer/releases/download/studio-v" +
        studioRelease.version +
        "/" +
        asset.fileName,
    );
    expect(asset.sizeBytes).toBeGreaterThan(0);
    expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/);
  });
  it("formats byte sizes consistently", () => {
    expect(formatBytes(123500000)).toBe("123.5 MB");
  });
});
