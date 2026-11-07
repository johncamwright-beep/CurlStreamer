import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser: m.user } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { GET, POST } from "./route";
const opponentId = "11111111-1111-4111-8111-111111111111",
  seasonId = "22222222-2222-4222-8222-222222222222";
const input = {
  opponentId,
  seasonId,
  level: "U20",
  roster: { lead: "  Alex  " },
  expectedRevision: 0,
};
const post = (body: unknown) =>
  new Request("https://test/api/opponent-seasons", {
    method: "POST",
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({
    data: { user: { id: "verified", email_confirmed_at: "now" } },
  });
  m.rpc.mockResolvedValue({
    data: [
      {
        opponent_id: opponentId,
        season_id: seasonId,
        level: "U20",
        roster: { lead: "Alex" },
        revision: 1,
      },
    ],
    error: null,
  });
});
it("requires verified authentication before reads or writes", async () => {
  m.user.mockResolvedValue({ data: { user: null } });
  expect((await GET()).status).toBe(401);
  expect((await POST(post(input))).status).toBe(401);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("validates and saves only the signed-in user's season with concurrency control", async () => {
  const response = await POST(post(input));
  expect(response.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("save_opponent_season", {
    p_user_id: "verified",
    p_opponent_id: opponentId,
    p_season_id: seasonId,
    p_level: "U20",
    p_roster: {
      lead: "Alex",
      second: "",
      third: "",
      fourth: "",
      alternate: "",
      coach: "",
    },
    p_expected_revision: 0,
  });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
it("rejects injected scope, malformed names and invalid revisions before querying", async () => {
  for (const patch of [
    { userId: "attacker" },
    { roster: { lead: "x".repeat(101) } },
    { roster: { unknown: "name" } },
    { expectedRevision: -1 },
    { level: "anything" },
    { seasonId: "bad" },
  ])
    expect((await POST(post({ ...input, ...patch }))).status).toBe(400);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("reports conflicts and authorization failures without leaking database details", async () => {
  for (const [code, status] of [
    ["40001", 409],
    ["42501", 403],
    ["XX000", 503],
  ] as const) {
    m.rpc.mockResolvedValue({
      error: { code, message: "secret database details" },
    });
    const response = await POST(post(input));
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("secret");
  }
});
it("scopes both directory reads to the verified user", async () => {
  m.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "list_seasons"
        ? [{ id: seasonId, name: "2026-27", status: "active" }]
        : [],
    error: null,
  }));
  expect((await GET()).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith("list_seasons", { p_user_id: "verified" });
  expect(m.rpc).toHaveBeenCalledWith("list_opponent_seasons", {
    p_user_id: "verified",
  });
});
