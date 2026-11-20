import { expect, it } from "vitest";
import { relativeDifficulty } from "./event-performance";
it("uses a common season rating reference without clipping", () => {
  expect(
    relativeDifficulty({ averageDifficulty: 1.8, seasonDifficulty: 1.8 }),
  ).toBeCloseTo(100);
  expect(
    relativeDifficulty({ averageDifficulty: 1.98, seasonDifficulty: 1.8 }),
  ).toBeCloseTo(110);
  expect(
    relativeDifficulty({ averageDifficulty: 1.62, seasonDifficulty: 1.8 }),
  ).toBeCloseTo(90);
  expect(
    relativeDifficulty({ averageDifficulty: 3, seasonDifficulty: 1 }),
  ).toBeCloseTo(300);
});
it("leaves missing ratings unavailable rather than zero", () => {
  expect(
    relativeDifficulty({ averageDifficulty: null, seasonDifficulty: 1.8 }),
  ).toBeNull();
  expect(relativeDifficulty({ averageDifficulty: 1.8 })).toBeNull();
  expect(
    relativeDifficulty({ averageDifficulty: NaN, seasonDifficulty: 1.8 }),
  ).toBeNull();
  expect(
    relativeDifficulty({ averageDifficulty: 1.8, seasonDifficulty: 0 }),
  ).toBeNull();
});
