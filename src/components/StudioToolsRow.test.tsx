import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { StudioToolsRow } from "./StudioToolsRow";
describe("compact Studio tools", () => {
  it("keeps camera settings, replay and celebrations in that order in three equal columns", () => {
    const html = renderToStaticMarkup(
      <StudioToolsRow
        cameraSettings={<button>Camera Settings</button>}
        replay={<button>Replay</button>}
        celebrations={<button>Celebrations</button>}
      />,
    );
    expect(html).toContain('aria-label="Studio tools"');
    expect(html).toContain("grid-template-columns:repeat(3,minmax(0,1fr))");
    expect(html.indexOf("Camera Settings")).toBeLessThan(
      html.indexOf("Replay"),
    );
    expect(html.indexOf("Replay")).toBeLessThan(html.indexOf("Celebrations"));
  });
});
