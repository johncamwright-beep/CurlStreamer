import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  state: vi.fn(),
  videos: vi.fn(),
  corrections: vi.fn(),
  standalone: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("@/lib/curlcoach/access", () => ({
  labEnabled: () => false,
  sameOrigin: (r: Request) => r.headers.get("origin") === "http://localhost",
}));
vi.mock("@/lib/curlcoach/production-access", () => ({
  requireCoachAccount: m.account,
}));
vi.mock("@/lib/providers/curlcoach-store", () => ({ loadCoachState: m.state }));
vi.mock("@/lib/providers/curlcoach-video", () => ({
  loadCoachBroadcastReviews: m.videos,
}));
vi.mock("@/lib/providers/shot-review-corrections", () => ({
  loadReviewCorrections: m.corrections,
}));
vi.mock("@/lib/providers/standalone-reviews", () => ({
  loadStandaloneReviews: m.standalone,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { POST } from "./route";
const gameId = "00000000-0000-4000-8000-000000000001",
  shotId = "00000000-0000-4000-8000-000000000002",
  reviewId = "00000000-0000-4000-8000-000000000004";
const body = {
  gameId,
  shotId,
  requestId: "00000000-0000-4000-8000-000000000003",
  startSeconds: 132,
  note: "Review release",
};
const standaloneBody = {
  gameId,
  reviewId,
  requestId: body.requestId,
  startSeconds: body.startSeconds,
  note: body.note,
};
const request = (data: unknown = body, origin = "http://localhost") =>
  new Request("http://localhost/api/curlcoach/review", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(data),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CURLCOACH_ENABLED", "true");
  m.account.mockResolvedValue({ organizationId: "team", userId: "coach" });
  m.state.mockResolvedValue({
    status: "closed",
    events: [{ shotId, shot: { flagged: true } }],
  });
  m.videos.mockResolvedValue({
    [gameId]: { url: "https://www.youtube.com/watch?v=abcdefghijk" },
  });
  m.rpc.mockResolvedValue({ error: null });
  m.corrections.mockResolvedValue({});
  m.standalone.mockResolvedValue({});
});
it("keeps a manually corrected timestamp on the original recording after replacement", async () => {
  m.videos.mockResolvedValue({
    [gameId]: { url: "https://www.youtube.com/watch?v=SecondVideo" },
  });
  m.corrections.mockResolvedValue({
    [gameId]: [
      {
        shotId,
        video: {
          url: "https://youtu.be/abcdefghijk",
          positionSeconds: 65,
          lookBackSeconds: 0,
        },
        note: "Earlier correction",
      },
    ],
  });
  expect((await POST(request())).status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "save_shot_tracker_review_correction",
    expect.objectContaining({
      p_url: "https://www.youtube.com/watch?v=abcdefghijk",
      p_start: 132,
    }),
  );
});
afterEach(() => vi.unstubAllEnvs());
it("saves exact timing separately for a closed game using server-owned identity and recording", async () => {
  const result = await POST(request());
  expect(result.status).toBe(200);
  expect(m.rpc).toHaveBeenCalledWith(
    "save_shot_tracker_review_correction",
    expect.objectContaining({
      p_actor: "coach",
      p_org: "team",
      p_start: 132,
      p_note: body.note,
      p_url: "https://www.youtube.com/watch?v=abcdefghijk",
    }),
  );
  expect(result.headers.get("cache-control")).toContain("no-store");
});
it("rejects cross-origin, absent access, identity overrides and invalid times", async () => {
  expect((await POST(request(body, "https://other.test"))).status).toBe(403);
  for (const bad of [
    { ...body, actor: "other" },
    { ...body, startSeconds: -1 },
    { ...body, startSeconds: 1.2 },
    { ...body, reviewId },
    { ...standaloneBody, recording: "https://youtu.be/abcdefghijk" },
  ])
    expect((await POST(request(bad))).status).toBe(400);
  m.account.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
  expect(m.rpc).not.toHaveBeenCalled();
});
it("saves an exact standalone correction on the recording that contains the flag", async () => {
  const review = {
    id: reviewId,
    selectedAt: "2026-11-10T15:00:00Z",
  };
  m.standalone.mockResolvedValue({ [gameId]: [review] });
  m.videos.mockResolvedValue({
    [gameId]: {
      url: "https://youtu.be/SecondVideo",
      startedAt: "2026-11-10T16:00:00Z",
      previous: [
        {
          url: "https://youtu.be/abcdefghijk",
          startedAt: "2026-11-10T14:58:00Z",
          endedAt: "2026-11-10T15:59:00Z",
        },
      ],
    },
  });
  expect((await POST(request(standaloneBody))).status).toBe(200);
  expect(m.standalone).toHaveBeenCalledWith(
    { organizationId: "team", userId: "coach" },
    [gameId],
    reviewId,
  );
  expect(m.rpc).toHaveBeenCalledWith("save_standalone_review_correction", {
    p_actor: "coach",
    p_org: "team",
    p_game: gameId,
    p_review: reviewId,
    p_request: standaloneBody.requestId,
    p_url: "https://www.youtube.com/watch?v=abcdefghijk",
    p_start: 132,
    p_note: standaloneBody.note,
  });

  m.videos.mockClear();
  m.standalone.mockResolvedValue({
    [gameId]: [
      {
        ...review,
        videoReview: {
          url: "https://youtu.be/abcdefghijk",
          positionSeconds: 132,
          lookBackSeconds: 0,
        },
      },
    ],
  });
  expect((await POST(request(standaloneBody))).status).toBe(200);
  expect(m.rpc.mock.calls[1]).toEqual(m.rpc.mock.calls[0]);
  expect(m.videos).not.toHaveBeenCalled();
});
it("rejects an absent standalone flag before reading recording metadata", async () => {
  m.standalone.mockResolvedValue({ [shotId]: [{ id: reviewId }] });
  expect((await POST(request(standaloneBody))).status).toBe(404);
  expect(m.videos).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("never saves another coach's absent, deleted or explicitly unflagged shot", async () => {
  for (const events of [
    [],
    [{ shotId, shot: null }],
    [{ shotId, shot: { flagged: false, review: "Team" } }],
  ]) {
    m.state.mockResolvedValue({ events });
    expect((await POST(request())).status).toBe(404);
  }
  expect(m.videos).not.toHaveBeenCalled();
  expect(m.rpc).not.toHaveBeenCalled();
});
it("does not read video metadata when game authorization fails or leak server errors", async () => {
  m.state.mockRejectedValue(new Error("private credential"));
  const result = await POST(request());
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain("credential");
  expect(m.videos).not.toHaveBeenCalled();
});
