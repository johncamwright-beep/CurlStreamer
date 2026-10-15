import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  enabled: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.auth,
}));
vi.mock("@/lib/providers/curlcoach-admin", () => ({
  curlCoachAdminEnabled: mocks.enabled,
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
const request = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/account/curlcoach", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "owner" }, role: "owner" });
  mocks.enabled.mockReturnValue(true);
  mocks.rpc.mockResolvedValue({ data: { seats: 2, members: [] }, error: null });
});
it("requires an authenticated team and owner for assignments", async () => {
  mocks.auth.mockResolvedValue(null);
  expect((await GET()).status).toBe(403);
  for (const role of ["viewer", "game_operator", "team_admin"]) {
    mocks.auth.mockResolvedValue({ user: { id: "member" }, role });
    expect((await POST(request({ membershipIds: [id] }))).status).toBe(403);
  }
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("rejects cross-origin writes and injected actors or seat counts", async () => {
  expect(
    (await POST(request({ membershipIds: [id] }, "https://other"))).status,
  ).toBe(403);
  for (const body of [
    { membershipIds: [id], actor: "other" },
    { membershipIds: [id], seats: 99 },
    { membershipIds: ["invalid"] },
  ])
    expect((await POST(request(body))).status).toBe(400);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("uses the session actor and supports clearing assignments", async () => {
  expect((await POST(request({ membershipIds: [] }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("assign_team_curlcoach", {
    p_actor: "owner",
    p_membership_ids: [],
  });
});
it("reports database rejection without leaking details", async () => {
  mocks.rpc.mockResolvedValue({
    error: { message: "sensitive database detail" },
  });
  const response = await POST(request({ membershipIds: [id] }));
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain("sensitive");
});
it("keeps licence responses private and disables operations with the feature flag", async () => {
  expect((await GET()).headers.get("Cache-Control")).toBe("private, no-store");
  mocks.rpc.mockClear();
  mocks.enabled.mockReturnValue(false);
  expect((await POST(request({ membershipIds: [id] }))).status).toBe(404);
  expect(await (await GET()).json()).toEqual({ available: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
