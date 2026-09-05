import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  issueChooserToken,
  issueOrganizerToken,
  issueParticipantToken,
} from "@/lib/tokens";

const gameId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
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
  completeReviewedGame,
  reviewGameCompletion,
  verifiedCompletionAccount,
} from "./game-completion";

describe("internal game completion boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv(
      "ROLE_TOKEN_SECRET",
      "curlcast-local-completion-test-secret-32-characters",
    );
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "33333333-3333-4333-8333-333333333333",
          email_confirmed_at: "2026-09-04T12:00:00.000Z",
        },
      },
      error: null,
    });
  });

  async function account() {
    const credential = await verifiedCompletionAccount();
    if (!credential.ok) throw new Error("expected verified account");
    return credential.value;
  }

  it("delegates only a server-verified account to the organization-scoped RPC", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          review_id: reviewId,
          input_revision: 42,
          result: {
            outcome: "tie",
            label: "Tie",
            totals: { home: 3, away: 3 },
            ends: [],
          },
        },
      ],
      error: null,
    });
    const result = await reviewGameCompletion(gameId, await account());
    expect(result.ok).toBe(true);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith(
      "review_game_completion_with_link",
      expect.objectContaining({
        p_game_id: gameId,
        p_actor_user_id: "33333333-3333-4333-8333-333333333333",
        p_verified_organizer: false,
        p_youtube_watch_url: null,
      }),
    );
  });

  it("denies an account without a verified email before database access", async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: { id: "33333333-3333-4333-8333-333333333333" },
      },
      error: null,
    });
    expect(await verifiedCompletionAccount()).toEqual({
      ok: false,
      kind: "authorization",
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["inactive", "scorer", "cross-organization"])(
    "preserves the database denial for a verified but %s account",
    async () => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
      expect(await reviewGameCompletion(gameId, await account())).toEqual({
        ok: false,
        kind: "authorization",
      });
    },
  );

  it("accepts a valid same-game organizer credential", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await reviewGameCompletion(gameId, {
      kind: "organizer",
      token: await issueOrganizerToken(gameId),
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "review_game_completion_with_link",
      expect.objectContaining({
        p_game_id: gameId,
        p_actor_user_id: null,
        p_verified_organizer: true,
      }),
    );
  });

  it.each([
    () => issueOrganizerToken("44444444-4444-4444-8444-444444444444"),
    () => issueParticipantToken(gameId, "scorer", crypto.randomUUID()),
    () => issueParticipantToken(gameId, "camera-home", crypto.randomUUID()),
    () => issueChooserToken(gameId),
  ])("denies non-organizer and cross-game credentials", async (token) => {
    const result = await reviewGameCompletion(gameId, {
      kind: "organizer",
      token: await token(),
    });
    expect(result).toEqual({ ok: false, kind: "authorization" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps stale reviewed revisions to an explicit conflict", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    expect(
      await completeReviewedGame(gameId, reviewId, {
        kind: "organizer",
        token: await issueOrganizerToken(gameId),
      }),
    ).toEqual({ ok: false, kind: "conflict" });
  });

  it("returns the database completion identity on idempotent retries", async () => {
    const completed = {
      completion_id: "55555555-5555-4555-8555-555555555555",
      review_id: reviewId,
      input_revision: 42,
      result: {
        outcome: "no_result",
        label: "No result recorded",
        totals: null,
        ends: [],
      },
      completed_at: "2026-09-04T12:00:00.000Z",
      cleanup_status: "pending",
    };
    mocks.rpc.mockResolvedValue({ data: [completed], error: null });
    const token = await issueOrganizerToken(gameId);
    const first = await completeReviewedGame(gameId, reviewId, {
      kind: "organizer",
      token,
    });
    const retry = await completeReviewedGame(gameId, reviewId, {
      kind: "organizer",
      token,
    });
    expect(first).toEqual(retry);
    expect(first).toMatchObject({
      ok: true,
      value: {
        completionId: completed.completion_id,
        reviewId,
        cleanupStatus: "pending",
      },
    });
  });

  it("returns the original stored review identity when a retry supplies another review", async () => {
    const storedReview = reviewId;
    mocks.rpc.mockResolvedValue({
      data: [
        {
          completion_id: "55555555-5555-4555-8555-555555555555",
          review_id: storedReview,
          input_revision: 42,
          result: {
            outcome: "tie",
            label: "Tie",
            totals: { home: 1, away: 1 },
            ends: [],
          },
          completed_at: "2026-09-04T12:00:00.000Z",
          cleanup_status: "pending",
        },
      ],
      error: null,
    });
    const differentReview = "66666666-6666-4666-8666-666666666666";
    const result = await completeReviewedGame(gameId, differentReview, {
      kind: "organizer",
      token: await issueOrganizerToken(gameId),
    });
    expect(result).toMatchObject({
      ok: true,
      value: { reviewId: storedReview },
    });
  });
});
