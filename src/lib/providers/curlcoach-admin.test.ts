import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));

import {
  changeCurlCoachAccess,
  curlCoachAdminEnabled,
  setCurlCoachEntitlement,
} from "./curlcoach-admin";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  mocks.rpc.mockResolvedValue({ error: null });
});

it("is disabled unless the global CurlCoach flag is explicitly enabled", () => {
  expect(curlCoachAdminEnabled({ CURLCOACH_ENABLED: "false" })).toBe(false);
  expect(curlCoachAdminEnabled({})).toBe(false);
  expect(curlCoachAdminEnabled({ CURLCOACH_ENABLED: "true" })).toBe(true);
});

it("uses the verified actor identity for bounded access grants and revocations", async () => {
  await changeCurlCoachAccess({
    actorUserId: "admin-id",
    targetUserId: "member-id",
    action: "grant",
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
  await changeCurlCoachAccess({
    actorUserId: "admin-id",
    targetUserId: "member-id",
    action: "revoke",
  });

  expect(mocks.rpc.mock.calls).toEqual([
    [
      "grant_curlcoach_access",
      {
        p_actor_user_id: "admin-id",
        p_target_user_id: "member-id",
        p_expires_at: "2027-01-01T00:00:00.000Z",
      },
    ],
    [
      "revoke_curlcoach_access",
      { p_actor_user_id: "admin-id", p_target_user_id: "member-id" },
    ],
  ]);
});

it("records entitlement changes through the dedicated audited RPC", async () => {
  await setCurlCoachEntitlement({
    actorUserId: "platform-admin",
    organizationId: "organization-id",
  });
  expect(mocks.rpc).toHaveBeenCalledWith("set_curlcoach_entitlement", {
    p_actor_user_id: "platform-admin",
    p_organization_id: "organization-id",
    p_expires_at: null,
  });
});
