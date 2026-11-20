import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: vi.fn(),
  enabled: vi.fn(),
  change: vi.fn(),
  entitlement: vi.fn(),
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: mocks.auth,
  sameOriginWrite: (request: Request) =>
    request.headers.get("origin") === new URL(request.url).origin,
}));
vi.mock("@/lib/providers/curlcoach-admin", () => ({
  curlCoachAdminEnabled: mocks.enabled,
  changeCurlCoachAccess: mocks.change,
  setCurlCoachEntitlement: mocks.entitlement,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from "./route";

const id = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/platform/curlcoach", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.enabled.mockReturnValue(true);
  mocks.change.mockResolvedValue(undefined);
  mocks.entitlement.mockResolvedValue(undefined);
});
it("requires platform administration and same-origin writes", async () => {
  expect((await GET()).status).toBe(403);
  expect(
    (await POST(request({ action: "revoke", targetUserId: id }))).status,
  ).toBe(403);
  mocks.auth.mockResolvedValue({ id: "verified-admin" });
  expect(
    (
      await POST(
        request({ action: "revoke", targetUserId: id }, "https://other"),
      )
    ).status,
  ).toBe(403);
  expect(mocks.change).not.toHaveBeenCalled();
});
it("has no database dependency while CurlCoach is disabled", async () => {
  mocks.auth.mockResolvedValue({ id: "verified-admin" });
  mocks.enabled.mockReturnValue(false);
  expect((await GET()).status).toBe(404);
  expect(
    (await POST(request({ action: "revoke", targetUserId: id }))).status,
  ).toBe(404);
  expect(mocks.change).not.toHaveBeenCalled();
  expect(mocks.entitlement).not.toHaveBeenCalled();
});
it("derives the actor only from platformAdminContext", async () => {
  mocks.auth.mockResolvedValue({ id: "verified-admin" });
  const response = await POST(
    request({
      action: "grant",
      targetUserId: id,
      expiresAt: "2027-01-01T00:00:00.000Z",
      actorUserId: "spoofed",
    }),
  );
  expect(response.status).toBe(200);
  expect(mocks.change).toHaveBeenCalledWith({
    action: "grant",
    actorUserId: "verified-admin",
    targetUserId: id,
    expiresAt: "2027-01-01T00:00:00.000Z",
  });
});
it("sends entitlement changes to the audited organization RPC", async () => {
  mocks.auth.mockResolvedValue({ id: "verified-admin" });
  const response = await POST(
    request({ action: "entitlement", organizationId: id }),
  );
  expect(response.status).toBe(200);
  expect(mocks.entitlement).toHaveBeenCalledWith({
    actorUserId: "verified-admin",
    organizationId: id,
    expiresAt: undefined,
  });
});

it("only sends validated licensed seat counts with the authenticated admin actor", async () => {
  mocks.auth.mockResolvedValue({ id: "verified-admin" });
  mocks.rpc.mockResolvedValue({ error: null });
  expect(
    (await POST(request({ action: "seats", organizationId: id, seats: 2 })))
      .status,
  ).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("set_curlcoach_seats", {
    p_actor: "verified-admin",
    p_organization_id: id,
    p_seats: 2,
  });
  mocks.rpc.mockClear();
  for (const seats of [0, 101, 1.5])
    expect(
      (await POST(request({ action: "seats", organizationId: id, seats })))
        .status,
    ).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
