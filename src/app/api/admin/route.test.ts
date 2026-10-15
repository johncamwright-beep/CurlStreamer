import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/providers/platform-admin", () => ({
  platformAdminContext: mocks.auth,
  sameOriginWrite: (r: Request) =>
    r.headers.get("origin") === new URL(r.url).origin,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from "./route";
const request = (body: unknown, origin = "https://test") =>
  new Request("https://test/api/admin", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue(null);
  mocks.rpc.mockResolvedValue({ data: { teams: [] }, error: null });
});
it("rejects ordinary accounts and cross-origin writes before admin data is used", async () => {
  expect((await GET()).status).toBe(403);
  expect(
    (
      await POST(
        request({
          action: "codes",
          count: 1,
          expiresAt: "2027-01-01T05:00:00Z",
        }),
      )
    ).status,
  ).toBe(403);
  mocks.auth.mockResolvedValue({ id: "real-admin" });
  expect((await POST(request({}, "https://other"))).status).toBe(403);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("stores only generated hashes with the verified administrator identity", async () => {
  mocks.auth.mockResolvedValue({ id: "real-admin" });
  const response = await POST(
    request({
      action: "codes",
      count: 2,
      expiresAt: "2027-01-01T05:00:00Z",
      userId: "spoofed",
    }),
  );
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.codes).toHaveLength(2);
  expect(result.codes[0]).not.toBe(result.codes[1]);
  const args = mocks.rpc.mock.calls[0][1];
  expect(args.p_user).toBe("real-admin");
  expect(args.p_hashes).toHaveLength(2);
  expect(args.p_hashes[0]).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(args)).not.toContain(result.codes[0]);
});
