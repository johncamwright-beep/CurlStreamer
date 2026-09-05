import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
const controls = readFileSync(
  new URL("../../../components/YouTubeSettingsControls.tsx", import.meta.url),
  "utf8",
);
const callback = readFileSync(
  new URL(
    "../../api/settings/youtube/oauth/callback/route.ts",
    import.meta.url,
  ),
  "utf8",
);

describe("YouTube settings surface", () => {
  it("shows safe team connection state and does not expose credentials", () => {
    expect(page).toContain("YouTube Settings");
    expect(page).toContain("membership.teamName");
    expect(controls).toContain("Test connection");
    expect(controls).toContain("No live");
    expect(controls).toContain("broadcast is started");
    expect(`${page}${controls}`).not.toMatch(/refresh[_ ]?token|clientSecret/i);
  });

  it("keeps management controls owner/admin-only and at least 44px high", () => {
    expect(page).toContain('["owner", "team_admin"]');
    expect(controls).toContain("canManage &&");
    expect(controls.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it("expires the OAuth cookie on the same callback path", () => {
    expect(callback).toContain('path: "/api/settings/youtube/oauth/callback"');
    expect(callback).toContain("maxAge: 0");
  });
});
