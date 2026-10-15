import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  account: vi.fn(),
  state: vi.fn(),
  videos: vi.fn(),
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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ rpc: m.rpc }),
}));
import { POST } from "./route";
const gameId = "00000000-0000-4000-8000-000000000001",
  shotId = "00000000-0000-4000-8000-000000000002";
const body = {
  gameId,
  shotId,
  requestId: "00000000-0000-4000-8000-000000000003",
  startSeconds: 132,
  note: "Review release",
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
  ])
    expect((await POST(request(bad))).status).toBe(400);
  m.account.mockResolvedValue(null);
  expect((await POST(request())).status).toBe(403);
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
