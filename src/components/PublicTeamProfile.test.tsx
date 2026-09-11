import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";
import { PublicTeamProfile } from "./PublicTeamProfile";

const accomplishment = {
  id: "event-1",
  name: "Provincials",
  end_date: "2026-02-01",
  result: "1st" as const,
  level: "U18" as const,
};

it("renders an accomplishment level only when that event permits it", () => {
  const settings = {
    ...defaultTeamPageSettings("Team Wright"),
    accomplishments: true,
  };
  const visible = renderToStaticMarkup(
    <PublicTeamProfile
      settings={settings}
      logo={null}
      accomplishments={[{ ...accomplishment, show_level: true }]}
    />,
  );
  const hidden = renderToStaticMarkup(
    <PublicTeamProfile
      settings={settings}
      logo={null}
      accomplishments={[{ ...accomplishment, show_level: false }]}
    />,
  );

  expect(visible).toContain("Provincials · U18");
  expect(hidden).toContain("Provincials");
  expect(hidden).not.toContain("U18");
});
