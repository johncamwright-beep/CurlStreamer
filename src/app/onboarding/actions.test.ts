import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  context: vi.fn(),
  updateUser: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser, updateUser: mocks.updateUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/auth/account", () => ({ getAccountContext: mocks.context }));
import { createFirstTeam, saveSetupProgress } from "./actions";

describe("createFirstTeam", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({
      ok: true,
      account: { profile: { status: "active" }, membership: null },
    });
    mocks.updateUser.mockResolvedValue({ error: null });
  });
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
    mocks.rpc.mockResolvedValue({
      data: [{ organization_id: "22222222-2222-4222-8222-222222222222" }],
      error: null,
    });
    const data = new FormData();
    data.set("teamName", "  Granite   Club ");
    data.set("userId", "attacker-id");
    await expect(createFirstTeam({}, data)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).toHaveBeenCalledWith("create_first_team", {
      p_user_id: "verified-id",
      p_team_name: "Granite Club",
    });
    expect(mocks.redirect).toHaveBeenCalledWith("/onboarding?start=1");
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: {
        team_setup: {
          organizationId: "22222222-2222-4222-8222-222222222222",
          step: 1,
          complete: false,
        },
      },
    });
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
  it("does not enrol an existing member automatically", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-id", email_confirmed_at: "now" } },
    });
    mocks.context.mockResolvedValue({
      ok: true,
      account: { membership: { role: "owner" } },
    });
    const form = new FormData();
    form.set("teamName", "Existing");
    await expect(createFirstTeam({}, form)).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
  it("saves progress only for the active team's owner", async () => {
    const organizationId = "22222222-2222-4222-8222-222222222222";
    const progress = { organizationId, step: 3, complete: false };
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "verified-id", email_confirmed_at: "now" } },
    });
    for (const role of ["viewer", "scorer", "team_admin"]) {
      mocks.context.mockResolvedValue({
        ok: true,
        account: {
          profile: { status: "active" },
          membership: { role, organization_id: organizationId },
        },
      });
      expect(await saveSetupProgress(progress)).toHaveProperty("error");
    }
    expect(mocks.updateUser).not.toHaveBeenCalled();
    mocks.context.mockResolvedValue({
      ok: true,
      account: {
        profile: { status: "active" },
        membership: { role: "owner", organization_id: organizationId },
      },
    });
    expect(
      await saveSetupProgress({
        ...progress,
        organizationId: "33333333-3333-4333-8333-333333333333",
      }),
    ).toHaveProperty("error");
    expect(await saveSetupProgress(progress)).toEqual({ success: true });
    expect(mocks.updateUser).toHaveBeenCalledWith({
      data: { team_setup: progress },
    });
    mocks.updateUser.mockResolvedValue({ error: { message: "private error" } });
    expect(await saveSetupProgress(progress)).toEqual({
      error: "Progress could not be saved. Please try again.",
    });
  });
});
