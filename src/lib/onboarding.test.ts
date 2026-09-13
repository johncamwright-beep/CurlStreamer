import { describe, expect, it } from "vitest";
import { readSetupProgress, setupProgressSchema } from "./onboarding";
const organizationId = "11111111-1111-4111-8111-111111111111";
describe("team setup preferences", () => {
  it("leaves existing users without setup preferences alone", () => {
    expect(readSetupProgress(undefined, organizationId)).toBeNull();
  });
  it("does not resume another team's preferences", () => {
    expect(
      readSetupProgress(
        { organizationId, step: 2 },
        "22222222-2222-4222-8222-222222222222",
      ),
    ).toBeNull();
  });
  it("resumes valid steps and preserves completion", () => {
    expect(
      readSetupProgress(
        { organizationId, step: 5, complete: false },
        organizationId,
      )?.step,
    ).toBe(5);
    expect(
      readSetupProgress(
        { organizationId, step: 6, complete: true },
        organizationId,
      )?.complete,
    ).toBe(true);
  });
  it("rejects malformed progress and unsafe resource identifiers", () => {
    for (const step of [0, 7, 2.5, "3"])
      expect(
        setupProgressSchema.safeParse({ organizationId, step }).success,
      ).toBe(false);
    expect(
      setupProgressSchema.safeParse({
        organizationId,
        step: 6,
        gameId: "//evil.example",
      }).success,
    ).toBe(false);
  });
});
