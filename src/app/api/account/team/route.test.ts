import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.context,
  readTeamSettings: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/providers/sponsor-library", () => ({
  validateSponsorImage: vi.fn(),
}));
import { PATCH } from "./route";
import { defaultTeamPageSettings } from "@/lib/team-page-settings";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue(null);
});
describe("team settings writes", () => {
  it("rejects non administrators before database access", async () => {
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: "{}",
          }),
        )
      ).status,
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses only the authenticated organization", async () => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    mocks.rpc.mockResolvedValue({ error: null });
    const settings = defaultTeamPageSettings("Team Benning");
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: JSON.stringify(settings),
          }),
        )
      ).status,
    ).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("update_team_public_profile", {
      p_org: "trusted-org",
      p_settings: settings,
    });
  });
  it("rejects caller supplied organization fields", async () => {
    mocks.context.mockResolvedValue({ organizationId: "trusted-org" });
    expect(
      (
        await PATCH(
          new Request("https://test/api/account/team", {
            method: "PATCH",
            body: JSON.stringify({
              ...defaultTeamPageSettings("Team Benning"),
              organizationId: "other",
            }),
          }),
        )
      ).status,
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
