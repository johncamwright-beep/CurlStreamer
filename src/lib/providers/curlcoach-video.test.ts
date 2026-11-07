import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { loadCoachBroadcastReviews } from "./curlcoach-video";
const gid = "00000000-0000-4000-8000-000000000002";
beforeEach(() => vi.clearAllMocks());
it("uses the actor-scoped metadata RPC without reading private tables or credentials", async () => {
  m.rpc.mockResolvedValue({
    data: [
      {
        game_id: gid,
        youtube_broadcast_id: "abcdefghijk",
        started_at: "2026-10-10T12:00:00Z",
        stopped_at: "2026-10-10T14:00:00Z",
      },
    ],
    error: null,
  });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      startedAt: "2026-10-10T12:00:00Z",
      endedAt: "2026-10-10T14:00:00Z",
      estimated: true,
    },
  });
  expect(m.rpc).toHaveBeenCalledWith("read_shot_tracker_recordings", {
    p_actor: "coach",
    p_org: "team",
    p_games: [gid],
  });
});
it("retains known recording links without inventing timing and ignores invalid or unrequested neighbors", async () => {
  m.rpc.mockResolvedValue({
    data: [
      { game_id: gid, youtube_broadcast_id: "abcdefghijk" },
      { game_id: gid, youtube_broadcast_id: "invalid" },
      {
        game_id: "00000000-0000-4000-8000-000000000003",
        youtube_broadcast_id: "abcdefghijk",
      },
    ],
    error: null,
  });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: { url: "https://www.youtube.com/watch?v=abcdefghijk" },
  });
});
it("keeps authorization failures private and skips empty selections", async () => {
  m.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
  expect(await loadCoachBroadcastReviews("other-team", [gid], "coach")).toEqual(
    {},
  );
  m.rpc.mockClear();
  expect(await loadCoachBroadcastReviews("team", [], "coach")).toEqual({});
  expect(m.rpc).not.toHaveBeenCalled();
});
