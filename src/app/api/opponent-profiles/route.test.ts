import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: m.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { GET, POST } from "./route";
const opponentId = "11111111-1111-4111-8111-111111111111";
const profileId = "22222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({
    data: { user: { id: "verified-user", email_confirmed_at: "now" } },
  });
  m.rpc.mockResolvedValue({
    data: [{ id: opponentId, display_name: "Opponent" }],
    error: null,
  });
});
const post = (value: unknown) =>
  new Request("https://www.curlstreamer.app/api/opponent-profiles", {
    method: "POST",
    body: JSON.stringify(value),
  });
it("requires a verified identity for directory reads and links", async () => {
  m.user.mockResolvedValue({ data: { user: null } });
  expect((await GET(new Request("https://test?q=team"))).status).toBe(401);
  expect((await POST(post({ profileId }))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("passes only the verified identity and validated link identifiers", async () => {
  expect(
    (
      await POST(
        post({
          profileId,
          opponentId,
          userId: "attacker",
          organizationId: "attacker",
        }),
      )
    ).status,
  ).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("link_opponent_profile", {
    p_user_id: "verified-user",
    p_opponent_id: opponentId,
    p_profile_id: profileId,
  });
});
it("rejects malformed identifiers, empty unlink, and oversized searches before querying", async () => {
  for (const value of [
    { profileId: "bad" },
    { profileId: null },
    { profileId, opponentId: "bad" },
  ])
    expect((await POST(post(value))).status).toBe(400);
  for (const query of ["a", "a".repeat(101)])
    expect((await GET(new Request("https://test?q=" + query))).status).toBe(
      400,
    );
  expect(m.rpc).not.toHaveBeenCalled();
});
it("supports explicit unlink and enforces database authorization failures", async () => {
  await POST(post({ profileId: null, opponentId }));
  expect(m.rpc).toHaveBeenCalledWith("link_opponent_profile", {
    p_user_id: "verified-user",
    p_opponent_id: opponentId,
    p_profile_id: null,
  });
  m.rpc.mockResolvedValue({
    error: { code: "42501", message: "private database information" },
  });
  const response = await POST(post({ profileId, opponentId }));
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("private database");
});
it("uses separate scoped reads and bounded public searches", async () => {
  const response = await GET(
    new Request(`https://test?opponentId=${opponentId}`),
  );
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(m.rpc).toHaveBeenCalledWith("read_opponent_profile", {
    p_user_id: "verified-user",
    p_opponent_id: opponentId,
  });
  await GET(new Request("https://test?q=Granite"));
  expect(m.rpc).toHaveBeenCalledWith("search_opponent_profiles", {
    p_user_id: "verified-user",
    p_query: "Granite",
  });
});
