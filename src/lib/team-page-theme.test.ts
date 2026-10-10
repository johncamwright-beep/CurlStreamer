import { describe, expect, it } from "vitest";
import { contrastText, luminance, teamThemeStyle } from "./team-page-theme";
import {
  defaultTeamPageSettings,
  teamPageSettingsSchema,
} from "./team-page-settings";

describe("public team colors", () => {
  it("keeps text readable across light, dark and jersey colors", () => {
    for (const color of [
      "#ffffff",
      "#000000",
      "#ffff00",
      "#ff0000",
      "#0000ff",
      "#808080",
    ]) {
      const a = luminance(color),
        b = luminance(contrastText(color));
      expect(
        (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("uses readable panel links when accent matches the panel", () => {
    expect(
      teamThemeStyle({
        background: "#ffffff",
        panel: "#ffffff",
        accent: "#ffffff",
      }),
    ).toMatchObject({ "--panel-link": "#000000" });
  });
  it("rejects CSS injection and preserves saved theme values", () => {
    const settings = defaultTeamPageSettings("Team Benning");
    settings.theme = {
      background: "#123456",
      panel: "#abcdef",
      accent: "#ff0000",
    };
    expect(teamPageSettingsSchema.parse(settings).theme).toEqual(
      settings.theme,
    );
    expect(
      teamPageSettingsSchema.safeParse({
        ...settings,
        theme: { ...settings.theme, background: "red;display:none" },
      }).success,
    ).toBe(false);
  });
});
