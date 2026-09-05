import { beforeEach, describe, expect, it, vi } from "vitest";

const gameId = "11111111-1111-4111-8111-111111111111";
const reviewId = "22222222-2222-4222-8222-222222222222";
const account = { kind: "account", userId: "account-user" };
const organizer = { kind: "organizer", token: "organizer-token" };
const summary = {
  status: "completed",
  eventName: "Final",
  homeName: "Home",
  awayName: "Away",
  result: {
    outcome: "home_win",
    label: "Home win",
    totals: { home: 4, away: 2 },
    ends: [],
  },
  youtubeWatchUrl: "https://youtu.be/abcdefghi",
  completedAt: "2026-09-05T00:00:00Z",
};
const mocks = vi.hoisted(() => ({
  verified: vi.fn(),
  review: vi.fn(),
  complete: vi.fn(),
  getCleanup: vi.fn(),
  recordCleanup: vi.fn(),
  readSummary: vi.fn(),
  terminate: vi.fn(),
  listGenerations: vi.fn(),
  readToken: vi.fn(),
}));
vi.mock("@/lib/game-completion", () => ({
  verifiedCompletionAccount: mocks.verified,
  reviewGameCompletion: mocks.review,
  completeReviewedGame: mocks.complete,
  getCompletionCleanup: mocks.getCleanup,
  recordCompletionCleanup: mocks.recordCleanup,
  readGameCompletionSummary: mocks.readSummary,
}));
vi.mock("@/lib/providers/livekit", () => ({
  terminateGameLiveKit: mocks.terminate,
}));
vi.mock("@/lib/store", () => ({
  listCameraIdentityGenerations: mocks.listGenerations,
}));
vi.mock("@/lib/tokens", () => ({ readAccessToken: mocks.readToken }));

import { POST } from "./route";

function request(body: unknown, bearer?: string) {
  return new Request(`https://example.test/api/games/${gameId}/completion`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("End Game route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.verified.mockResolvedValue({ ok: true, value: account });
    mocks.readToken.mockRejectedValue(new Error("stale participant"));
    mocks.review.mockResolvedValue({
      ok: true,
      value: {
        reviewId,
        inputRevision: 4,
        result: summary.result,
        youtubeWatchUrl: null,
      },
    });
    mocks.complete.mockResolvedValue({
      ok: true,
      value: { cleanupStatus: "pending" },
    });
    mocks.getCleanup.mockResolvedValue({
      ok: true,
      value: { status: "pending", attempts: 0, lastError: null },
    });
    mocks.recordCleanup.mockResolvedValue({
      ok: true,
      value: { status: "complete", attempts: 1, lastError: null },
    });
    mocks.readSummary.mockResolvedValue(summary);
    mocks.terminate.mockResolvedValue(undefined);
    mocks.listGenerations.mockResolvedValue({
      "camera-home": [1, 3],
      "camera-away": [2],
    });
  });

  it("falls back to a verified account when a stored bearer is a scorer", async () => {
    mocks.readToken.mockResolvedValue({
      purpose: "participant",
      gameId,
      role: "scorer",
    });
    const response = await POST(
      request({ action: "review", youtubeWatchUrl: "" }, "stale-token"),
      { params: Promise.resolve({ id: gameId }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.review).toHaveBeenCalledWith(gameId, account, null);
  });

  it("accepts a cryptographically verified same-game organizer", async () => {
    mocks.readToken.mockResolvedValue({ purpose: "organizer", gameId });
    await POST(
      request({ action: "review", youtubeWatchUrl: "" }, organizer.token),
      {
        params: Promise.resolve({ id: gameId }),
      },
    );
    expect(mocks.review).toHaveBeenCalledWith(gameId, organizer, null);
    expect(mocks.verified).not.toHaveBeenCalled();
  });

  it("returns the saved result while recording an honest cleanup failure", async () => {
    mocks.terminate.mockRejectedValue(new Error("provider unavailable"));
    mocks.recordCleanup.mockResolvedValue({
      ok: true,
      value: {
        status: "failed",
        attempts: 1,
        lastError: "LiveKit room shutdown was not confirmed",
      },
    });
    const response = await POST(request({ action: "complete", reviewId }), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      completion: summary,
      cleanup: { status: "failed", attempts: 1 },
    });
    expect(mocks.terminate).toHaveBeenCalledWith(gameId, {
      "camera-home": [1, 3],
      "camera-away": [2],
    });
  });

  it("does not repeat provider teardown after cleanup is complete", async () => {
    mocks.getCleanup.mockResolvedValue({
      ok: true,
      value: { status: "complete", attempts: 1, lastError: null },
    });
    const response = await POST(request({ action: "complete", reviewId }), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(response.status).toBe(200);
    expect(mocks.terminate).not.toHaveBeenCalled();
    expect(mocks.recordCleanup).not.toHaveBeenCalled();
  });

  it("reports completion as saved when summary retrieval briefly fails", async () => {
    mocks.readSummary.mockRejectedValue(new Error("read unavailable"));
    const response = await POST(request({ action: "complete", reviewId }), {
      params: Promise.resolve({ id: gameId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ completionSaved: true });
  });
});
