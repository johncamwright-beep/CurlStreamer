import React from "react";
import { afterAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamSetupChecklist } from "./TeamSetupChecklist";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";

vi.stubGlobal("React", React);
afterAll(() => vi.unstubAllGlobals());

const complete = {
  organizationId: "test-team",
  settings: {
    ...defaultTeamPageSettings("Test Curling Club"),
    published: true,
    roster: {
      fourth: "Ellis",
      third: "Reese",
      second: "Cameron",
      lead: "Jamie",
      skip: "fourth" as const,
    },
  },
  logo: "/team-logo.png",
  seasons: 1,
  games: 1,
};

it("omits the walkthrough when all five items are ready even with older setup progress", () => {
  expect(
    renderToStaticMarkup(<TeamSetupChecklist {...complete} resumeStep={2} />),
  ).toBe("");
});

it("shows all readiness items and resume information inside a collapsed walkthrough", () => {
  const html = renderToStaticMarkup(
    <TeamSetupChecklist {...complete} games={0} resumeStep={5} />,
  );
  expect(html).toContain("<details>");
  expect(html).toContain(
    "<summary>Complete your team setup – walkthrough</summary>",
  );
  expect(html).toContain("4/5 ready");
  expect(html).toContain("First game — To do");
  expect(html).toContain("Step 5 of 6");
  expect(html).toContain("Resume team setup");
  expect(html).toContain(">Dismiss</button>");
});
