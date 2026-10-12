import { beforeEach, expect, it, vi } from "vitest";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabaseClient: () => ({ from: mock.from }),
}));
import { loadReviewCorrections } from "./shot-review-corrections";
const game = "00000000-0000-4000-8000-000000000001";
const shot = "00000000-0000-4000-8000-000000000002";
const account = { organizationId: "team", userId: "coach" } as CoachAccount;
let query: {
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    order: vi.fn(),
  };
  mock.from.mockReturnValue(query);
});
it("reads only this coach's authorized games and overlays the latest correction", async () => {
  const row = {
    game_id: game,
    shot_id: shot,
    video_url: "https://www.youtube.com/watch?v=abcdefghijk",
    start_seconds: 132,
    note: "New note",
  };
  query.order.mockResolvedValue({
    data: [row, { ...row, start_seconds: 50, note: "Old note" }],
    error: null,
  });
  expect(await loadReviewCorrections(account, [game])).toEqual({
    [game]: [
      {
        shotId: shot,
        note: "New note",
        video: {
          url: row.video_url,
          positionSeconds: 132,
          lookBackSeconds: 0,
          delaySeconds: 0,
        },
      },
    ],
  });
  expect(query.eq.mock.calls).toEqual([
    ["organization_id", "team"],
    ["actor_user_id", "coach"],
  ]);
  expect(query.in).toHaveBeenCalledWith("game_id", [game]);
  expect(query.order).toHaveBeenCalledWith("sequence", { ascending: false });
});
it("tolerates an unapplied additive migration but does not hide other read failures", async () => {
  query.order.mockResolvedValue({ data: null, error: { code: "42P01" } });
  expect(await loadReviewCorrections(account, [game])).toEqual({});
  query.order.mockResolvedValue({ data: null, error: { code: "42501" } });
  await expect(loadReviewCorrections(account, [game])).rejects.toThrow(
    "unavailable",
  );
});
