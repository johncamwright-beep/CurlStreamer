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
  const legacyReview = "00000000-0000-4000-8000-000000000003";
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
          audience: "team",
          player_id: null,
          player_name: null,
          note: "Original note",
          selected_at: selectedAt,
          end_number: 6,
          shot_number: 7,
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
        audience: "team",
        playerId: null,
        playerName: null,
        note: "",
        selectedAt,
        shotContext: { end: 6, shot: 7 },
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

  query.order.mockResolvedValue({
    data: [
      {
        request_id: legacyReview,
        game_id: game,
        audience: "team",
        player_id: null,
        player_name: null,
        note: "Legacy team flag",
        selected_at: selectedAt,
        end_number: null,
        shot_number: null,
      },
    ],
    error: null,
  });
  admin.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202" } });
  const [legacy] = (await loadStandaloneReviews(account, [game]))[game];
  expect(legacy.note).toBe("Legacy team flag");
  expect(legacy.shotContext).toBeUndefined();
  expect(legacy.videoReview).toBeUndefined();
});
