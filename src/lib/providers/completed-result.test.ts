import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: mocks.rpc }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
  }),
}));
import {
  readCompletedResult,
  correctCompletedResult,
} from "./completed-result";
const id = "11111111-1111-4111-8111-111111111111";
const user = "22222222-2222-4222-8222-222222222222";
const correction = {
  requestId: "33333333-3333-4333-8333-333333333333",
  expectedRevision: 42,
  ends: [],
  reason: "No scored ends were played",
};
const snapshot = {
  revision: 43,
  completion: {
    status: "completed",
    eventName: "Final",
    homeName: "Home",
    awayName: "Away",
    completedAt: "2026-10-05T18:00:00Z",
    youtubeWatchUrl: null,
    result: {
      outcome: "no_result",
      label: "No result recorded",
      totals: null,
      ends: [],
    },
  },
};
describe("completed result account boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { id: user, email_confirmed_at: "2026-10-01" } },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: snapshot, error: null });
  });
  it("uses only server-verified account identity and preserves idempotent request values", async () => {
    expect(await correctCompletedResult(id, correction)).toEqual({
      ok: true,
      value: snapshot,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("correct_completed_game_result", {
      p_game_id: id,
      p_actor_user_id: user,
      p_request_id: correction.requestId,
      p_expected_revision: 42,
      p_ends: [],
      p_reason: correction.reason,
    });
  });
  it("denies unsigned or unverified users before RPC access", async () => {
    for (const account of [null, { id: user, email_confirmed_at: null }]) {
      mocks.getUser.mockResolvedValue({ data: { user: account }, error: null });
      expect(await readCompletedResult(id)).toEqual({
        ok: false,
        kind: "authorization",
      });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("maps scoped authorization/conflict/terminal errors and rejects malformed service data", async () => {
    for (const [code, kind] of [
      ["42501", "authorization"],
      ["PT409", "conflict"],
      ["55000", "terminal"],
      ["42703", "service"],
    ]) {
      mocks.rpc.mockResolvedValue({ data: null, error: { code } });
      expect(await correctCompletedResult(id, correction)).toEqual({
        ok: false,
        kind,
      });
    }
    mocks.rpc.mockResolvedValue({
      data: { ...snapshot, revision: "not-a-revision" },
      error: null,
    });
    expect(await readCompletedResult(id)).toEqual({
      ok: false,
      kind: "service",
    });
  });
});
