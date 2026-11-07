import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioReleaseDescriptor } from "@/lib/studio-release";
import DownloadPage from "./page";

const fixture = vi.hoisted(() => ({ value: {} as StudioReleaseDescriptor }));
vi.mock("@/lib/studio-release", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/studio-release")>()),
  get studioRelease() {
    return fixture.value;
  },
}));
vi.stubGlobal("React", React);
const base = {
  channel: "pilot",
  version: "0.4.0-pilot.1",
  platform: "Windows",
  architecture: "x64",
} as const;

describe("DownloadPage", () => {
  it("does not offer a download before publication", () => {
    fixture.value = { ...base, availability: "unpublished" };
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain("Release pending");
    expect(html).not.toContain("releases/download/");
    expect(html).toContain("Close CurlStreamer Studio before installing");
    expect(html).toContain("Existing recordings are preserved");
    expect(html).toContain("WebView2 Runtime");
  });
  it("offers the verified versioned asset and its size and checksum", () => {
    const url =
      "https://github.com/johncamwright-beep/CurlStreamer/releases/download/studio-v0.4.0-pilot.1/Studio-Setup.exe";
    fixture.value = {
      ...base,
      availability: "published",
      installer: {
        fileName: "Studio-Setup.exe",
        url,
        sizeBytes: 123000000,
        sha256: "a".repeat(64),
      },
    };
    const html = renderToStaticMarkup(<DownloadPage />);
    expect(html).toContain(url);
    expect(html).toContain("123 MB");
    expect(html).toContain("a".repeat(64));
    expect(html).toContain("Unsigned pilot installer");
    expect(html).not.toContain("Release pending");
  });
});
