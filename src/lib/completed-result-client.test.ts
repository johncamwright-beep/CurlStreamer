import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CompletedResultRequestError,
  prepareCompletedResultCorrection,
  requestCompletedResult,
  retainNewestCompletedResult,
  completedResultReplySchema,
} from "./completed-result-client";

const requestId = "10000000-0000-4000-8000-000000000001";
const saved = {
  revision: 3,
  completion: {
    status: "completed",
    eventName: "Club night",
    homeName: "Birch",
    awayName: "Maple",
    completedAt: "2026-10-05T12:00:00Z",
    youtubeWatchUrl: null,
    result: {
      outcome: "home_win",
      label: "Home win",
      totals: { home: 2, away: 0 },
      ends: [{ end: 1, team: "home", points: 2, blank: false }],
    },
  },
};
afterEach(() => vi.unstubAllGlobals());

describe("completed result correction client", () => {
  it("retains a newer confirmed snapshot when an old retry receipt arrives", () => {
    const current = completedResultReplySchema.parse(saved);
    const oldReceipt = { ...current, revision: 2 };
    expect(retainNewestCompletedResult(current, oldReceipt)).toBe(current);
    const newer = { ...current, revision: 4 };
    expect(retainNewestCompletedResult(current, newer)).toBe(newer);
  });
  it("prepares an independent validated payload so a retry keeps the same ID, revision, ends and reason", async () => {
    const draft = [{ end: 1, team: "home" as const, points: 2, blank: false }];
    const pending = prepareCompletedResultCorrection(
      2,
      draft,
      "  Typo in End 1  ",
      requestId,
    );
    draft[0].points = 8;
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("lost response"))
      .mockResolvedValueOnce(Response.json(saved));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestCompletedResult("game", pending)).rejects.toMatchObject(
      { kind: "uncertain" },
    );
    expect(await requestCompletedResult("game", pending)).toEqual(saved);
    const firstBody = fetchMock.mock.calls[0][1].body;
    expect(fetchMock.mock.calls[1][1].body).toBe(firstBody);
    expect(JSON.parse(firstBody)).toEqual({
      requestId,
      expectedRevision: 2,
      ends: [{ end: 1, team: "home", points: 2, blank: false }],
      reason: "Typo in End 1",
    });
  });

  it("accepts a no-result correction and rejects invalid blank/scored ends or a missing reason", () => {
    expect(
      prepareCompletedResultCorrection(0, [], "No ends were played", requestId)
        .ends,
    ).toEqual([]);
    expect(() =>
      prepareCompletedResultCorrection(
        0,
        [{ end: 1, team: "home", points: 0, blank: true }],
        "Fix",
        requestId,
      ),
    ).toThrow();
    expect(() =>
      prepareCompletedResultCorrection(
        0,
        [{ end: 2, team: "home", points: 1, blank: false }],
        "Fix",
        requestId,
      ),
    ).toThrow();
    expect(() =>
      prepareCompletedResultCorrection(0, [], "  ", requestId),
    ).toThrow();
  });

  it.each([409, 403, 400, 503])(
    "classifies HTTP %i without accepting an error as a saved score",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(Response.json({ error: "Failed" }, { status })),
      );
      await expect(
        requestCompletedResult(
          "game",
          prepareCompletedResultCorrection(2, [], "Fix", requestId),
        ),
      ).rejects.toMatchObject({
        kind:
          status === 409
            ? "conflict"
            : status === 403
              ? "authorization"
              : status === 400
                ? "invalid"
                : "uncertain",
      });
    },
  );

  it("does not treat an incomplete or malformed successful response as database-confirmed success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ revision: 3, success: true })),
    );
    await expect(
      requestCompletedResult(
        "game",
        prepareCompletedResultCorrection(2, [], "Fix", requestId),
      ),
    ).rejects.toBeInstanceOf(CompletedResultRequestError);
  });

  it("loads the authoritative saved snapshot using a noncached GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(saved));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestCompletedResult("game")).toEqual(saved);
    expect(fetchMock).toHaveBeenCalledWith("/api/games/game/result", {
      method: "GET",
      cache: "no-store",
    });
  });
});
