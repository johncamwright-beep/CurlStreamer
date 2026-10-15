import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { WindowsStudioRequired } from "./WindowsStudioRequired";

vi.stubGlobal("React", React);

describe("WindowsStudioRequired", () => {
  it("directs recording-PC operators to the Studio download page", () => {
    const html = renderToStaticMarkup(
      <WindowsStudioRequired gameId="game-1" />,
    );

    expect(html).toContain('href="/download"');
    expect(html).toContain('href="/games/game-1/studio"');
    expect(html).not.toContain("there is no public download yet");
  });
});
