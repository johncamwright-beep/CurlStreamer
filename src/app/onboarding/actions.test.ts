import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { createFirstTeam } from "./actions";

describe("createFirstTeam", () => {
  beforeEach(() => vi.clearAllMocks());
  it("requires verified authentication", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });
    const data = new FormData();
    data.set("teamName", "Granite");
    await expect(createFirstTeam({}, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith("/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("uses the verified identity and ignores browser-supplied IDs", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-id", email_confirmed_at: "now" } },
    });
    mocks.rpc.mockResolvedValue({ error: null });
    const data = new FormData();
    data.set("teamName", "  Granite   Club ");
    data.set("userId", "attacker-id");
    await expect(createFirstTeam({}, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).toHaveBeenCalledWith("create_first_team", {
      p_user_id: "verified-id",
      p_team_name: "Granite Club",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/dashboard");
  });
  it("returns a safe access-denied response for a suspended account", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-id", email_confirmed_at: "now" } },
    });
    mocks.rpc.mockResolvedValue({
      error: { code: "42501", message: "database detail" },
    });
    const data = new FormData();
    data.set("teamName", "Granite");
    expect(await createFirstTeam({}, data)).toEqual({
      message: "Your account cannot create a team.",
    });
  });
});
