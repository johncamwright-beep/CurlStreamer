import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("sponsor management separation", () => {
  const library = readFileSync("src/app/sponsors/SponsorLibrary.tsx", "utf8");
  const control = readFileSync(
    "src/components/ScoringProgramControls.tsx",
    "utf8",
  );

  it("uses compact active rows and a collapsed disabled section", () => {
    expect(library).toContain("h-20 w-20");
    expect(library).toContain("Disabled sponsors (");
    expect(library).toContain("<details");
    expect(library).toContain("disabled={index === 0}");
    expect(library).toContain("disabled={index === active.length - 1}");
    expect(library).toContain('{sponsor.archived ? "Enable" : "Disable"}');
  });

  it("keeps only carousel operations on scoring control", () => {
    expect(control).toContain("Carousel settings");
    expect(control).toContain("Start carousel");
    expect(control).toContain("Stop carousel");
    expect(control).toContain(">Sidebar</option>");
    expect(control).toContain(">Overlay</option>");
    expect(control).not.toContain("Add Sponsor Images");
    expect(control).not.toContain("Sponsor images</h2>");
  });
});
