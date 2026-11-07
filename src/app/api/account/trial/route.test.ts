import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ context: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/providers/team-settings", () => ({
  teamSettingsContext: mocks.context,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { POST } from "./route";
const code = "CURL-01234567-89ABCDEF-01234567-89ABCDEF";
const request = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/account/trial", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.context.mockResolvedValue({
    user: { id: "owner" },
    organizationId: "team",
  });
  mocks.rpc.mockResolvedValue({ data: "2027-01-01T05:00:00Z", error: null });
});
it("requires same-origin and administrator authority before using a code", async () => {
  expect((await POST(request({ code }, "https://other"))).status).toBe(403);
  mocks.context.mockResolvedValue(null);
  expect((await POST(request({ code }))).status).toBe(403);
  expect(mocks.context).toHaveBeenCalledWith(true);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("normalizes and hashes codes and derives identity from the authenticated context", async () => {
  expect((await POST(request({ code: code.toLowerCase() }))).status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("redeem_team_trial", {
    p_user_id: "owner",
    p_code_hash: createHash("sha256")
      .update(code.replaceAll("-", ""))
      .digest("hex"),
  });
  expect(
    (await POST(request({ code, userId: "other", organizationId: "other" })))
      .status,
  ).toBe(400);
});
it.each(["22023", "23514"])(
  "reports rejected redemption %s without exposing database errors",
  async (code) => {
    mocks.rpc.mockResolvedValue({
      error: { code, message: "private database detail" },
    });
    const response = await POST(
      request({ code: "CURL-01234567-89ABCDEF-01234567-89ABCDEF" }),
    );
    expect(response.status).toBe(409);
    expect(await response.text()).not.toContain("private database detail");
  },
);
