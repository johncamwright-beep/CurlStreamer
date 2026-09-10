import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioUsbAudio } from "./StudioUsbAudio";

describe("StudioUsbAudio", () => {
  it("renders an explicit diagnostic flow and makes no broadcast claim", () => {
    const markup = renderToStaticMarkup(<StudioUsbAudio />);
    expect(markup).toContain("Check USB microphones");
    expect(markup).toContain("Stop input check");
    expect(markup).toContain("Input check · not sent to YouTube yet");
    expect(markup).toContain("Select a USB microphone");
  });
});
