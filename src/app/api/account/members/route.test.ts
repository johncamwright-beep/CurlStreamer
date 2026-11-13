import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.auth,
}));
vi.mock("@/lib/providers/platform-admin", () => ({
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { POST } from "./route";
const request = (body: unknown) =>
  new Request("https://test/api/account/members", {
    method: "POST",
    headers: { origin: "https://test" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ user: { id: "real-owner" } });
  mocks.rpc.mockResolvedValue({ error: null });
});
it("requires a full-access team account and rejects owner-role escalation", async () => {
  mocks.auth.mockResolvedValue(null);
  expect(
    (
      await POST(
        request({
          action: "invite",
          email: "a@example.com",
          role: "team_admin",
        }),
      )
    ).status,
  ).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.auth.mockResolvedValue({ user: { id: "real-owner" } });
  expect(
    (
      await POST(
        request({ action: "invite", email: "a@example.com", role: "owner" }),
      )
    ).status,
  ).toBe(400);
});
it("binds invitation to the real actor and returns a link without storing raw tokens", async () => {
  const response = await POST(
    request({
      action: "invite",
      email: "a@example.com",
      role: "game_operator",
    }),
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  const token = new URL(body.inviteUrl).searchParams.get("token");
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
    p_user: "real-owner",
    p_role: "game_operator",
    p_email: "a@example.com",
  });
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(token!);
  expect(body.emailSent).toBe(false);
});
