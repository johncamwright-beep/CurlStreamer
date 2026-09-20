import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  from: vi.fn(),
  decrypt: vi.fn(),
  refresh: vi.fn(),
  request: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: m.from }),
}));
vi.mock("./youtube-credential-vault", () => ({
  decryptYouTubeRefreshToken: m.decrypt,
}));
vi.mock("./youtube", () => ({
  refreshYouTubeAccessToken: m.refresh,
  youtubeGoogleRequest: m.request,
}));
import { loadCoachBroadcastReviews } from "./curlcoach-video";
const gid = "00000000-0000-4000-8000-000000000002";
let filters: unknown[][];
beforeEach(() => {
  vi.clearAllMocks();
  filters = [];
  m.from.mockImplementation((table) => {
    const q = {
      select: vi.fn(() => q),
      eq: vi.fn((...args) => {
        filters.push(args);
        return q;
      }),
      in: vi.fn(async () => ({
        data: [{ game_id: gid, youtube_broadcast_id: "abcdefghijk" }],
        error: null,
      })),
      single: vi.fn(async () => ({
        data: { encrypted_credentials: "envelope" },
        error: null,
      })),
    };
    return q;
  });
  m.decrypt.mockReturnValue("private-refresh-token");
  m.refresh.mockResolvedValue("private-access-token");
  m.request.mockResolvedValue({
    items: [
      {
        id: "abcdefghijk",
        liveStreamingDetails: {
          actualStartTime: "2026-09-19T12:00:00Z",
          actualEndTime: "2026-09-19T14:00:00Z",
        },
      },
    ],
  });
});
it("scopes every database read, returns timing only, caches reads and separates tenants", async () => {
  const result = await loadCoachBroadcastReviews("team-a", [gid]);
  expect(filters.filter((f) => f[0] === "organization_id")).toEqual([
    ["organization_id", "team-a"],
    ["organization_id", "team-a"],
  ]);
  expect(result[gid]).toEqual({
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    startedAt: "2026-09-19T12:00:00Z",
    endedAt: "2026-09-19T14:00:00Z",
  });
  expect(JSON.stringify(result)).not.toContain("token");
  await loadCoachBroadcastReviews("team-a", [gid]);
  expect(m.refresh).toHaveBeenCalledTimes(1);
  await loadCoachBroadcastReviews("team-b", [gid]);
  expect(m.refresh).toHaveBeenCalledTimes(2);
});
it("does not fabricate timestamps for scheduled videos and isolates provider outages", async () => {
  m.request.mockResolvedValue({
    items: [
      {
        id: "abcdefghijk",
        liveStreamingDetails: { scheduledStartTime: "2026-09-19T12:00:00Z" },
      },
    ],
  });
  expect(await loadCoachBroadcastReviews("team-c", [gid])).toEqual({});
  m.refresh.mockRejectedValue(new Error("private error"));
  expect(await loadCoachBroadcastReviews("team-d", [gid])).toEqual({});
  expect(await loadCoachBroadcastReviews("team-d", [])).toEqual({});
});
