import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  loadActiveTeam: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/team-games", () => ({ loadActiveTeam: mocks.loadActiveTeam }));

import { requireCoachAccount } from "./production-access";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    error: null,
    data: { user: { id: "coach", email_confirmed_at: "2026-01-01T00:00:00Z" } },
  });
  mocks.loadActiveTeam.mockResolvedValue({
    kind: "ready",
    team: { organizationId: "organization" },
  });
  mocks.rpc.mockResolvedValue({ error: null });
});

it("fails closed before team or database access for unverified accounts", async () => {
  mocks.getUser.mockResolvedValue({
    error: null,
    data: { user: { id: "unverified", email_confirmed_at: null } },
  });
  await expect(requireCoachAccount()).resolves.toBeNull();
  expect(mocks.loadActiveTeam).not.toHaveBeenCalled();
  expect(mocks.rpc).not.toHaveBeenCalled();
});

it("derives the verified account scope and repeats access authorization in the database", async () => {
  await expect(requireCoachAccount()).resolves.toEqual({
    userId: "coach",
    organizationId: "organization",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("assert_curlcoach_access", {
    p_actor_user_id: "coach",
    p_organization_id: "organization",
  });
});

it("fails closed when the database rejects the entitlement or explicit grant", async () => {
  mocks.rpc.mockResolvedValue({ error: { code: "42501" } });
  await expect(requireCoachAccount()).resolves.toBeNull();
});
