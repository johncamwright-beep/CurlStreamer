import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";
import { PublicTeamProfile } from "./PublicTeamProfile";

const accomplishment = {
  id: "event-1",
  name: "Provincials",
  end_date:
    new Intl.DateTimeFormat("en", {
      year: "numeric",
      timeZone: "America/Toronto",
    }).format(new Date()) + "-02-01",
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
  expect(visible).toContain("1st place");
  expect(hidden).toContain("Provincials");
  expect(hidden).not.toContain("U18");
});

it("defaults to this year while offering past event years", () => {
  const html = renderToStaticMarkup(
    <PublicTeamProfile
      settings={{
        ...defaultTeamPageSettings("Team Wright"),
        accomplishments: true,
      }}
      logo={null}
      accomplishments={[
        {
          ...accomplishment,
          name: "Past championship",
          end_date: "2020-10-01",
          show_level: true,
        },
      ]}
    />,
  );
  expect(html).toContain('value="2020"');
  expect(html).toContain("All years");
  expect(html).toContain("No accomplishments recorded for");
  expect(html).not.toContain("Past championship");
});

it("renders up to two coach names between Players and Accomplishments", () => {
  const settings = defaultTeamPageSettings("Team Wright");
  const html = renderToStaticMarkup(
    <PublicTeamProfile
      settings={{
        ...settings,
        roster: { ...settings.roster, fourth: "Player One" },
        coaches: ["  Coach One  ", "Coach Two", "Ignored Coach"],
      }}
      logo={null}
      accomplishments={[{ ...accomplishment, show_level: true }]}
    />,
  );
  expect(html).toContain("Coach One");
  expect(html).toContain("Coach Two");
  expect(html).not.toContain("Ignored Coach");
  expect(html.indexOf(">Players<")).toBeLessThan(html.indexOf(">Coaches<"));
  expect(html.indexOf(">Coaches<")).toBeLessThan(
    html.indexOf(">Accomplishments<"),
  );
  const absent = renderToStaticMarkup(
    <PublicTeamProfile
      settings={{ ...settings, coaches: [] }}
      logo={null}
      accomplishments={[]}
    />,
  );
  expect(absent).not.toContain(">Coaches<");
});

it("keeps medal and star icons in the same fixed column with wrapping event text", () => {
  const html = renderToStaticMarkup(
    <PublicTeamProfile
      settings={defaultTeamPageSettings("Team Wright")}
      logo={null}
      accomplishments={[
        { ...accomplishment, show_level: true },
        {
          ...accomplishment,
          id: "qualified",
          name: "A longer qualifying event name",
          result: "qualified",
          show_level: false,
        },
      ]}
    />,
  );
  expect(html.match(/grid-cols-\[2rem_minmax\(0,1fr\)\]/g)).toHaveLength(2);
  expect(html.match(/h-8 w-8 items-center justify-center/g)).toHaveLength(2);
  expect(html).toContain("🥇");
  expect(html).toContain("★");
  expect(html).toContain('class="min-w-0 break-words"');
});
