import { expect, it } from "vitest";
import { append, emptyState, currentShots, type Shot } from "./model";
import { localReviewCommand, localReviewSaveSchema } from "./local-review";
const shot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 3,
  deficiency: "Heavy",
  review: null,
  excluded: null,
  note: "",
};
it("preserves scoring and shooter identity and makes retry append-only and idempotent", () => {
  const shotId = crypto.randomUUID();
  const state = append(
    emptyState(),
    { requestId: crypto.randomUUID(), expectedRevision: 0, shotId, shot },
    "coach",
  );
  const input = localReviewSaveSchema.parse({
    shotId,
    expectedRevision: 1,
    review: {
      version: 1,
      id: crypto.randomUUID(),
      gameId: crypto.randomUUID(),
      audience: "team",
      notes: "Discuss sweep call",
      selectedAt: "2026-11-09T20:00:10Z",
      capturedAt: "2026-11-09T20:01:00Z",
      timingEstimated: true,
    },
  });
  const next = append(state, localReviewCommand(state, input), "coach");
  expect(currentShots(next.events)[0]).toMatchObject({
    ...shot,
    note: input.review.notes,
    flagged: true,
    flagAudience: "team",
    flaggedAt: input.review.selectedAt,
  });
  expect(append(next, localReviewCommand(next, input), "coach")).toEqual(next);
  expect(() =>
    localReviewCommand(next, {
      ...input,
      review: { ...input.review, notes: "changed retry" },
    }),
  ).toThrow();
  expect(() =>
    localReviewCommand({ ...state, status: "closed" }, input),
  ).toThrow(/Reopen/);
  expect(() =>
    localReviewCommand(state, { ...input, shotId: crypto.randomUUID() }),
  ).toThrow(/not found/);
});
it("rejects actor/player overrides and selected times outside the camera window", () => {
  const input = {
    shotId: crypto.randomUUID(),
    expectedRevision: 0,
    review: {
      version: 1,
      id: crypto.randomUUID(),
      gameId: crypto.randomUUID(),
      audience: "player",
      notes: "",
      selectedAt: "2026-11-09T20:00:10Z",
      capturedAt: "2026-11-09T20:01:00Z",
      timingEstimated: true,
    },
  };
  expect(
    localReviewSaveSchema.safeParse({ ...input, actor: "other" }).success,
  ).toBe(false);
  expect(
    localReviewSaveSchema.safeParse({
      ...input,
      review: { ...input.review, playerId: "other" },
    }).success,
  ).toBe(false);
  expect(
    localReviewSaveSchema.safeParse({
      ...input,
      review: { ...input.review, selectedAt: "2026-11-09T19:00:00Z" },
    }).success,
  ).toBe(false);
});
