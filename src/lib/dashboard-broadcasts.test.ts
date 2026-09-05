import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  inside: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: mocks.from }),
}));
import { loadDashboardBroadcasts } from "./dashboard-broadcasts";
import type { AccountContext } from "./auth/account";
const account: AccountContext = {
  profile: { status: "active", display_name: "Admin" },
  membership: { organization_id: "team", role: "owner", teamName: "Team" },
};
beforeEach(() => {
  vi.clearAllMocks();
  const query = { select: mocks.select, eq: mocks.eq, in: mocks.inside };
  mocks.from.mockReturnValue(query);
  mocks.select.mockReturnValue(query);
  mocks.eq.mockReturnValue(query);
});
describe("dashboard broadcast metadata", () => {
  it("scopes display-only reads to membership and supplied game IDs", async () => {
    mocks.inside.mockResolvedValue({
      data: [
        {
          game_id: "one",
          status: "live",
          watch_url: "https://youtube.com/watch?v=abcdef12345",
          updated_at: "2026-09-01T00:00:00Z",
          encrypted_credentials: "never-export",
        },
        { game_id: "foreign", status: "live" },
      ],
      error: null,
    });
    const result = await loadDashboardBroadcasts(account, ["one"]);
    expect(mocks.select).toHaveBeenCalledWith(
      "game_id,status,watch_url,updated_at",
    );
    expect(mocks.eq).toHaveBeenCalledWith("organization_id", "team");
    expect(mocks.eq).toHaveBeenCalledWith("provider", "youtube");
    expect(mocks.inside).toHaveBeenCalledWith("game_id", ["one"]);
    expect(result.sessions).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("never-export");
    expect(result.sessions[0].gameId).toBe("one");
  });
  it("keeps games usable when status is unavailable and rejects unsafe links", async () => {
    mocks.inside.mockResolvedValueOnce({
      data: null,
      error: { message: "unavailable" },
    });
    expect(await loadDashboardBroadcasts(account, ["one"])).toEqual({
      available: false,
      sessions: [],
    });
    mocks.inside.mockResolvedValueOnce({
      data: [
        {
          game_id: "one",
          status: "live",
          watch_url: "javascript:alert(1)",
          updated_at: "bad",
        },
      ],
      error: null,
    });
    expect(
      (await loadDashboardBroadcasts(account, ["one"])).sessions[0],
    ).toMatchObject({ watchUrl: null, updatedAt: null });
  });
  it("does not query without active membership or authorized games", async () => {
    await loadDashboardBroadcasts({ ...account, membership: null }, ["one"]);
    await loadDashboardBroadcasts(
      { ...account, profile: { ...account.profile, status: "disabled" } },
      ["one"],
    );
    await loadDashboardBroadcasts(account, []);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
