import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PortraitVideo } from "./PortraitVideo";

describe("PortraitVideo", () => {
  it("always renders an inline, full-panel portrait video hook", () => {
    const markup = renderToStaticMarkup(<PortraitVideo autoPlay muted />);
    expect(markup).toContain("playsInline");
    expect(markup).toContain('class="portrait-camera-video"');
    expect(markup).toContain("autoPlay");
    expect(markup).toContain("muted");
  });
});
