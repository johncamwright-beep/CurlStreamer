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
  expect(m.rpc).toHaveBeenCalledWith("read_shot_tracker_recording_history_v2", {
    p_actor: "coach",
    p_org: "team",
    p_games: [gid],
  });
});
it("uses the older authorized read while the recording history upgrade propagates", async () => {
  m.rpc
    .mockResolvedValueOnce({ data: null, error: { code: "PGRST202" } })
    .mockResolvedValueOnce({
      data: [
        { game_id: gid, youtube_broadcast_id: "abcdefghijk", is_current: true },
      ],
      error: null,
    });
  expect(await loadCoachBroadcastReviews("team", [gid], "coach")).toEqual({
    [gid]: { url: "https://www.youtube.com/watch?v=abcdefghijk" },
  });
  expect(m.rpc).toHaveBeenLastCalledWith(
    "read_shot_tracker_recording_history",
    {
      p_actor: "coach",
      p_org: "team",
      p_games: [gid],
    },
  );
});
it("accounts for the off-air gap between two starts on the same YouTube video", async () => {
  m.rpc.mockResolvedValue({
    data: [
      {
        game_id: gid,
        youtube_broadcast_id: "abcdefghijk",
        started_at: "2026-11-11T13:23:23Z",
        is_current: true,
        delivery_gaps: [
          {
            stopped_at: "2026-11-11T13:50:43.535995Z",
            resumed_at: "2026-11-11T14:53:50.502711Z",
          },
        ],
      },
    ],
    error: null,
  });
  const broadcast = (await loadCoachBroadcastReviews("team", [gid], "coach"))[
    gid
  ];
  const flag = {
    id: gid,
    audience: "team" as const,
    playerId: null,
    playerName: null,
    note: "",
    selectedAt: "2026-11-11T14:54:59.294Z",
  };
  expect(reviewLink(standaloneReviewVideo(flag, broadcast))).toContain(
    "t=1709s",
  );
  expect(
    reviewLink(
      standaloneReviewVideo(
        { ...flag, selectedAt: "2026-11-11T13:40:00Z" },
        broadcast,
      ),
    ),
  ).toContain("t=997s");
  expect(
    standaloneReviewVideo(
      { ...flag, selectedAt: "2026-11-11T14:40:00Z" },
      broadcast,
    ),
  ).toMatchObject({
    positionSeconds: null,
    url: expect.stringContaining("abcdefghijk"),
  });
  expect(
    reviewLink(
      standaloneReviewVideo(
        {
          ...flag,
          videoReview: {
            url: "https://www.youtube.com/watch?v=abcdefghijk",
            positionSeconds: 1701,
            lookBackSeconds: 0,
          },
        },
        broadcast,
      ),
    ),
  ).toContain("t=1701s");
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
