import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, describe, expect, it, vi } from "vitest";
import { OpponentDetailsDialog } from "./OpponentDetailsDialog";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const props = {
  seasonId: "10000000-0000-4000-8000-000000000001",
  seasonName: "2026–27",
  onSaved: vi.fn(),
  onCancel: vi.fn(),
};

describe("combined opponent details dialog", () => {
  it("offers the saved name, competition level and all roster roles with one Save", () => {
    const html = renderToStaticMarkup(
      <OpponentDetailsDialog
        {...props}
        mode="create"
        initialName="Team Birch"
      />,
    );
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("Saved team name");
    expect(html).toContain('value="Team Birch"');
    for (const label of [
      "Competition level",
      "Lead",
      "Second",
      "Third",
      "Fourth",
      "Alternate",
      "Coach",
    ])
      expect(html).toContain(label);
    expect(html.match(/>Save<\/button>/g)).toHaveLength(1);
    expect(html).toContain("Cancel");
    expect(html).toContain("max-h-[90dvh]");
  });

  it("disables edits and Save while authoritative details load, avoiding a stale game name", () => {
    const html = renderToStaticMarkup(
      <OpponentDetailsDialog
        {...props}
        mode="edit"
        opponent={{
          id: "10000000-0000-4000-8000-000000000002",
          display_name: "Stale game snapshot",
        }}
      />,
    );
    expect(html).toContain("Loading opponent details…");
    expect(html).toContain('<fieldset disabled=""');
    expect(html).toMatch(/type="submit"[^>]*disabled=""/);
    expect(html).not.toContain("Stale game snapshot");
  });

  it("keeps game operators' name-only creation without offering restricted season edits", () => {
    const html = renderToStaticMarkup(
      <OpponentDetailsDialog
        {...props}
        mode="create"
        canManageSeasonDetails={false}
      />,
    );
    expect(html).toContain("Saved team name");
    expect(html).not.toContain("Competition level");
    expect(html).not.toContain("Name, if known");
    expect(html.match(/>Save<\/button>/g)).toHaveLength(1);
  });
});
