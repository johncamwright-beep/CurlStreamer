import { expect, it } from "vitest";
import { defaultTeamPageSettings } from "./team-page-settings";
import {
  teamMetadata,
  teamStructuredData,
  safeStructuredJson,
  curlStreamerSearchTitle,
  curlStreamerWebsiteStructuredData,
} from "./team-seo";
it("uses the team subdomain, profile photo and team name for search and sharing", () => {
  const s = {
    ...defaultTeamPageSettings("Team Benning"),
    published: true,
    photo: "https://example.com/team.jpg",
    description: "Ontario curling team",
  };
  const metadata = teamMetadata("teambenning", s, null);
  expect(metadata.alternates?.canonical).toBe(
    "https://teambenning.curlstreamer.app/",
  );
  expect(metadata.title).toBe(`Team Benning | ${curlStreamerSearchTitle}`);
  expect(metadata.description).toBe(s.description);
  expect(metadata.openGraph).toMatchObject({ images: [{ url: s.photo }] });
});
it("excludes hidden social links and safely encodes team-entered text", () => {
  const s = defaultTeamPageSettings("Team </script><script>alert(1)</script>");
  s.socials = false;
  s.facebook = "https://facebook.com/hidden";
  s.roster.third = "Alex";
  s.roster.skip = "third";
  const json = safeStructuredJson(teamStructuredData("team", s, null));
  expect(json).not.toContain("facebook.com");
  expect(json).not.toContain("</script>");
  expect(JSON.parse(json).mainEntity.athlete[0].name).toBe("Alex");
});

it("uses a stable square team favicon and natural curling search context", () => {
  const metadata = teamMetadata(
    "teambenning",
    defaultTeamPageSettings("Team Benning"),
    null,
  );
  expect(metadata.description).toContain("Team Benning curling");
  expect(metadata.icons).toMatchObject({
    icon: [
      {
        url: "https://teambenning.curlstreamer.app/team-icon.png",
        sizes: "96x96",
      },
    ],
  });
  expect(metadata).not.toHaveProperty("keywords");
});

it("prefers the complete bio over the tagline and keeps descriptions bounded", () => {
  const settings = {
    ...defaultTeamPageSettings("Team Benning"),
    tagline: "Short tagline",
    description: " Ontario curling team\n based in Cornwall. ",
  };
  expect(teamMetadata("teambenning", settings, null).description).toBe(
    "Ontario curling team based in Cornwall.",
  );
  settings.description = "Curling team based in Ontario. ".repeat(10);
  const description = teamMetadata("teambenning", settings, null).description!;
  expect(description.length).toBeLessThanOrEqual(160);
  expect(description.endsWith("…")).toBe(true);
  settings.description = "  ";
  expect(teamMetadata("teambenning", settings, null).description).toBe(
    settings.tagline,
  );
});

it("includes only configured public coach names in the team identity", () => {
  const settings = defaultTeamPageSettings("Team Benning");
  expect(
    teamStructuredData("teambenning", settings, null).mainEntity,
  ).not.toHaveProperty("coach");
  settings.coaches = ["Coach One", "Coach Two"];
  expect(
    teamStructuredData("teambenning", settings, null).mainEntity,
  ).toMatchObject({
    coach: [
      { "@type": "Person", name: "Coach One" },
      { "@type": "Person", name: "Coach Two" },
    ],
  });
});

it("declares the requested CurlStreamer search identity on the marketing homepage", () => {
  expect(curlStreamerWebsiteStructuredData()).toEqual({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "CurlStreamer - Curling Management App",
    alternateName: "CurlStreamer",
    url: "https://www.curlstreamer.app/",
  });
});
