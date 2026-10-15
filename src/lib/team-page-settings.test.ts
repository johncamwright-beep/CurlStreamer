import { describe, expect, it } from "vitest";
import {
  defaultTeamPageSettings,
  teamPageSettingsSchema,
} from "./team-page-settings";
describe("team publication settings", () => {
  it("defaults older profiles without coaches to an empty list", () => {
    const { coaches, ...legacy } = defaultTeamPageSettings("Team Benning");
    expect(coaches).toEqual([]);
    expect(teamPageSettingsSchema.parse(legacy).coaches).toEqual([]);
  });
  it("trims and preserves the order of two public coach names", () => {
    expect(
      teamPageSettingsSchema.parse({
        ...defaultTeamPageSettings("Team Benning"),
        coaches: ["  Alex Smith  ", "Sam Lee"],
      }).coaches,
    ).toEqual(["Alex Smith", "Sam Lee"]);
  });
  it.each([["Alex", "Sam", "Jordan"], ["  "], ["A".repeat(101)], [42]])(
    "rejects invalid public coach names %j",
    (...coaches) => {
      expect(
        teamPageSettingsSchema.safeParse({
          ...defaultTeamPageSettings("Team Benning"),
          coaches,
        }).success,
      ).toBe(false);
    },
  );
  it("starts private", () =>
    expect(defaultTeamPageSettings("Team Benning").published).toBe(false));
  it.each(["www", "admin", "../team", "a.b", "a--b"])(
    "rejects unsafe or reserved address %s",
    (slug) =>
      expect(
        teamPageSettingsSchema.safeParse({
          ...defaultTeamPageSettings("Team Benning"),
          slug,
        }).success,
      ).toBe(false),
  );
  it.each([
    "javascript:alert(1)",
    "https://facebook.com.evil.test/team",
    "https://user:pass@facebook.com/team",
    "http://facebook.com/team",
  ])("rejects misleading social link %s", (facebook) =>
    expect(
      teamPageSettingsSchema.safeParse({
        ...defaultTeamPageSettings("Team Benning"),
        facebook,
      }).success,
    ).toBe(false),
  );
  it("accepts official profile links", () =>
    expect(
      teamPageSettingsSchema.safeParse({
        ...defaultTeamPageSettings("Team Benning"),
        facebook: "https://www.facebook.com/team",
        instagram: "https://instagram.com/team",
      }).success,
    ).toBe(true));
});
