import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { loadCoachBroadcastReviews } from "./curlcoach-video";
import { reviewLink, withBroadcastReview } from "@/lib/curlcoach/review";
import { standaloneReviewVideo } from "@/lib/curlcoach/standalone-review";
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
        is_current: true,
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
  expect(m.rpc).toHaveBeenCalledWith("read_shot_tracker_recording_history", {
    p_actor: "coach",
    p_org: "team",
    p_games: [gid],
  });
});
it("retains known recording links without inventing timing and ignores invalid or unrequested neighbors", async () => {
  m.rpc.mockResolvedValue({
    data: [
      { game_id: gid, youtube_broadcast_id: "abcdefghijk", is_current: true },
      { game_id: gid, youtube_broadcast_id: "invalid", is_current: true },
      {
        game_id: "00000000-0000-4000-8000-000000000003",
        youtube_broadcast_id: "abcdefghijk",
        is_current: false,
      },
    ],
    error: null,
  });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: { url: "https://www.youtube.com/watch?v=abcdefghijk" },
  });
});
it("uses the earlier recording start for phone seeks without adding another lead-in", async () => {
  m.rpc.mockResolvedValue({
    data: [
      {
        game_id: gid,
        youtube_broadcast_id: "abcdefghijk",
        started_at: "2026-11-10T14:59:50Z",
        is_current: true,
      },
    ],
    error: null,
  });
  const broadcast = (await loadCoachBroadcastReviews("team", [gid], "coach"))[
    gid
  ];
  const selectedAt = "2026-11-10T15:00:30Z";
  const standalone = standaloneReviewVideo(
    {
      id: gid,
      audience: "team",
      playerId: null,
      playerName: null,
      note: "",
      selectedAt,
    },
    broadcast,
  );
  const shot = withBroadcastReview(
    {
      flaggedAt: selectedAt,
      videoReview: { url: "", positionSeconds: null, lookBackSeconds: 0 },
    },
    broadcast,
  ).videoReview;
  for (const video of [standalone, shot]) {
    expect(reviewLink(video)).toBe(
      "https://www.youtube.com/watch?v=abcdefghijk&t=40s",
    );
    expect(video).toMatchObject({ estimated: true, lookBackSeconds: 0 });
  }
});
it("retains earlier broadcast cycles newest first when the current broadcast is replaced", async () => {
  const older = {
    game_id: gid,
    youtube_broadcast_id: "oldercycle1",
    started_at: "2026-10-10T12:00:00Z",
    stopped_at: "2026-10-10T13:00:00Z",
    is_current: false,
  };
  const newer = {
    ...older,
    youtube_broadcast_id: "newercycle2",
    started_at: "2026-10-10T14:00:00Z",
    stopped_at: "2026-10-10T15:00:00Z",
  };
  const oldRecording = {
    url: "https://www.youtube.com/watch?v=oldercycle1",
    startedAt: older.started_at,
    endedAt: older.stopped_at,
    estimated: true,
  };
  const newRecording = {
    url: "https://www.youtube.com/watch?v=newercycle2",
    startedAt: newer.started_at,
    endedAt: newer.stopped_at,
    estimated: true,
  };

  m.rpc.mockResolvedValueOnce({
    data: [
      older,
      { game_id: gid, youtube_broadcast_id: "abcdefghijk", is_current: true },
      newer,
    ],
    error: null,
  });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      previous: [newRecording, oldRecording],
    },
  });

  m.rpc.mockResolvedValueOnce({
    data: [
      older,
      { game_id: gid, youtube_broadcast_id: null, is_current: true },
      newer,
    ],
    error: null,
  });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: { ...newRecording, previous: [oldRecording] },
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
