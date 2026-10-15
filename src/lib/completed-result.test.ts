import { describe, expect, it } from "vitest";
import { completedResultCorrectionSchema } from "./completed-result";

const input = {
  requestId: "11111111-1111-4111-8111-111111111111",
  expectedRevision: 12,
  reason: "  Correct the recorded second end  ",
  ends: [
    { end: 1, team: "home", points: 2, blank: false },
    { end: 2, team: null, points: 0, blank: true },
  ],
};
describe("audited completed result input", () => {
  it("requires a reason and ordered end scores while excluding derived totals and identity fields", () => {
    expect(completedResultCorrectionSchema.parse(input).reason).toBe(
      "Correct the recorded second end",
    );
    for (const invalid of [
      { ...input, reason: " " },
      { ...input, reason: "a".repeat(501) },
      { ...input, actorUserId: input.requestId },
      { ...input, totals: { home: 10, away: 0 } },
      { ...input, expectedRevision: -1 },
      { ...input, requestId: "untrusted" },
      { ...input, ends: [{ end: 2, team: "home", points: 2, blank: false }] },
      { ...input, ends: [{ end: 1, team: "home", points: 0, blank: false }] },
      { ...input, ends: [{ end: 1, team: null, points: 1, blank: true }] },
      { ...input, ends: [{ end: 1, team: "away", points: 9, blank: false }] },
    ])
      expect(completedResultCorrectionSchema.safeParse(invalid).success).toBe(
        false,
      );
    expect(
      completedResultCorrectionSchema.safeParse({ ...input, ends: [] }).success,
    ).toBe(true);
  });
});
