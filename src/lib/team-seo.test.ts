import { expect, it } from "vitest";
import { defaultTeamPageSettings } from "./team-page-settings";
import {
  teamMetadata,
  teamStructuredData,
  safeStructuredJson,
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
  expect(metadata.title).toContain("Team Benning");
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
