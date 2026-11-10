import { expect, it, vi } from "vitest";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
import { loadStandaloneReviews } from "./standalone-reviews";

const admin = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => admin,
}));

it("overlays the correction while retaining the bookmark identity and selected camera time", async () => {
  const game = "00000000-0000-4000-8000-000000000001";
  const review = "00000000-0000-4000-8000-000000000002";
  const account = { organizationId: "team", userId: "coach" } as CoachAccount;
  const selectedAt = "2026-11-10T15:00:00.000Z";
  const url = "https://www.youtube.com/watch?v=abcdefghijk";
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({
      data: [
        {
          request_id: review,
          game_id: game,
          audience: "player",
          player_id: "lead",
          player_name: "Alex",
          note: "Original note",
          selected_at: selectedAt,
        },
      ],
      error: null,
    }),
  };
  admin.from.mockReturnValue(query);
  admin.rpc.mockResolvedValue({
    data: [
      {
        review_id: review,
        video_url: url,
        start_seconds: 0,
        note: "",
      },
    ],
    error: null,
  });
  expect(await loadStandaloneReviews(account, [game], review)).toEqual({
    [game]: [
      {
        id: review,
        audience: "player",
        playerId: "lead",
        playerName: "Alex",
        note: "",
        selectedAt,
        videoReview: { url, positionSeconds: 0, lookBackSeconds: 0 },
      },
    ],
  });
  expect(query.eq.mock.calls).toEqual([
    ["organization_id", "team"],
    ["actor_user_id", "coach"],
    ["request_id", review],
  ]);
  expect(admin.rpc).toHaveBeenCalledWith("read_standalone_review_corrections", {
    p_actor: "coach",
    p_org: "team",
    p_games: [game],
  });

  admin.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  const original = (await loadStandaloneReviews(account, [game]))[game][0];
  expect(original.note).toBe("Original note");
  expect(original.videoReview).toBeUndefined();
});
