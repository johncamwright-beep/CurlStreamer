import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
import { reopenGame } from "./game-reopen";
const game = "11111111-1111-4111-8111-111111111111",
  user = "22222222-2222-4222-8222-222222222222";
const input = {
  requestId: "33333333-3333-4333-8333-333333333333",
  expectedRevision: 42,
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: user, email_confirmed_at: "2026-11-03" } },
  });
  mocks.rpc.mockResolvedValue({ data: { status: "active", gameId: game } });
});
it("uses verified server identity and the submitted revision", async () => {
  expect(await reopenGame(game, input)).toEqual({ ok: true });
  expect(mocks.rpc).toHaveBeenCalledWith("reopen_completed_game", {
    p_game_id: game,
    p_actor_user_id: user,
    p_request_id: input.requestId,
    p_expected_revision: 42,
  });
});
it("rejects unverified callers before database access", async () => {
  mocks.getUser.mockResolvedValue({ data: { user: { id: user } } });
  expect(await reopenGame(game, input)).toEqual({ ok: false, code: "42501" });
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("does not claim success for a different game or provider failure", async () => {
  mocks.rpc.mockResolvedValue({ data: { status: "active", gameId: user } });
  expect(await reopenGame(game, input)).toEqual({ ok: false, code: "service" });
  mocks.rpc.mockResolvedValue({ error: { code: "PT423" } });
  expect(await reopenGame(game, input)).toEqual({ ok: false, code: "PT423" });
});
