import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  rpc: vi.fn(),
  cleanup: vi.fn(),
}));
vi.mock("@/lib/game-completion", () => ({
  verifiedCompletionAccount: m.account,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
vi.mock("@/lib/game-deletion-cleanup", () => ({
  cleanupDeletedGame: m.cleanup,
}));
import { DELETE } from "./route";
const id = "00000000-0000-4000-8000-000000000001";
function request(
  body: unknown = { confirmed: true },
  origin = "https://example.test",
) {
  return new Request("https://example.test/api/events/" + id + "/deletion", {
    method: "DELETE",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}
const context = { params: Promise.resolve({ id }) };
beforeEach(() => {
  vi.clearAllMocks();
  m.account.mockResolvedValue({
    ok: true,
    value: { kind: "account", userId: id },
  });
  m.rpc.mockResolvedValue({ data: [id], error: null });
  m.cleanup.mockResolvedValue({
    kind: "recorded",
    cleanup: { status: "complete" },
  });
});
it("requires explicit confirmation and rejects cross-origin requests before mutation", async () => {
  expect((await DELETE(request({}), context)).status).toBe(400);
  expect(
    (await DELETE(request({ confirmed: true }, "https://other.test"), context))
      .status,
  ).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("rejects unauthenticated callers", async () => {
  m.account.mockResolvedValue({ ok: false });
  expect((await DELETE(request(), context)).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("preserves live-session conflicts without attempting cleanup", async () => {
  m.rpc.mockResolvedValue({ error: { code: "55000" } });
  expect((await DELETE(request(), context)).status).toBe(409);
  expect(m.cleanup).not.toHaveBeenCalled();
});
it("reports committed deletion separately from provider cleanup failure", async () => {
  m.cleanup.mockRejectedValue(new Error("offline"));
  const response = await DELETE(request(), context);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    deleted: true,
    gameIds: [id],
    cleanupPending: true,
  });
});
