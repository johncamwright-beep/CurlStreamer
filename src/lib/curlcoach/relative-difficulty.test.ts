import { expect, it } from "vitest";
import { relativeDifficulty } from "./event-performance";

it("centres relative difficulty on history and spans ten raw percentage points each way", () => {
  // Raw 32% = ordinal mean 1.64. The score is display-only.
  const score = (raw: number) =>
    relativeDifficulty({
      averageDifficulty: 1 + raw / 50,
      baselineDifficulty: 1.64,
    });
  expect(score(32)).toBeCloseTo(50);
  expect(score(27)).toBeCloseTo(25);
  expect(score(37)).toBeCloseTo(75);
  expect(score(22)).toBeCloseTo(0);
  expect(score(42)).toBeCloseTo(100);
  expect(score(0)).toBe(0);
  expect(score(100)).toBe(100);
});
it("does not fabricate typical difficulty when current or historical ratings are absent", () => {
  expect(
    relativeDifficulty({ averageDifficulty: null, baselineDifficulty: 1.5 }),
  ).toBeNull();
  expect(
    relativeDifficulty({ averageDifficulty: 1.5, baselineDifficulty: null }),
  ).toBeNull();
  expect(
    relativeDifficulty({ averageDifficulty: NaN, baselineDifficulty: 1.5 }),
  ).toBeNull();
  expect(
    relativeDifficulty({ averageDifficulty: 1, baselineDifficulty: 1 }),
  ).toBe(50);
});
