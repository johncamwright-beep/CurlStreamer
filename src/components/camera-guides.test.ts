import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("camera guide visibility", () => {
  it("removes local guides as soon as preview frames play", () => {
    const page = readFileSync(
      new URL("../app/camera/[id]/[role]/page.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain("onPlaying={() => setPreviewReady(true)}");
    expect(page.match(/!previewReady &&/g)).toHaveLength(2);
  });

  it("keeps broadcast artwork inside the non-live placeholder", () => {
    const feed = readFileSync(
      new URL("./LiveKitCameraFeed.tsx", import.meta.url),
      "utf8",
    );
    const placeholder = feed.indexOf("!playable");
    expect(
      feed.indexOf('data-testid="camera-placeholder-guides"'),
    ).toBeGreaterThan(placeholder);
  });

  it("stacks connection status above placeholder artwork", () => {
    const css = readFileSync(
      new URL("../app/globals.css", import.meta.url),
      "utf8",
    );
    expect(css).toMatch(/camera-placeholder-status[\s\S]*z-index: 2/);
    expect(css).toMatch(/camera-placeholder \[data-testid[\s\S]*z-index: 1/);
  });
});
