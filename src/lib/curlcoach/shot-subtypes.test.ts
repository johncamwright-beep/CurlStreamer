import { describe, expect, it } from "vitest";
import {
  shotSubtypes,
  entryChoices,
  allWeights,
  allResults,
} from "./shot-subtypes";
import { shotTypes } from "./model";
import { emptySupplement, supplementSchema } from "./enhanced-catalog";
import { changeObservation } from "./result-entry";

describe("workbook shot entries", () => {
  it("covers all 26 workbook subtypes without introducing Standard categories", () => {
    expect(shotSubtypes).toHaveLength(26);
    expect(new Set(shotSubtypes.map((s) => s.id)).size).toBe(26);
    for (const s of shotSubtypes) {
      expect(shotTypes).toContain(s.standard);
      expect(s.weights.length).toBeGreaterThan(0);
      expect(s.results.length).toBeGreaterThan(0);
      expect(
        supplementSchema.safeParse({
          ...emptySupplement(),
          values: {
            shotSubtype: s.id,
            intendedWeight: s.weights[0],
            observedDestination: s.weights.at(-1),
            resultObservations: s.results,
          },
          assessments: { destination: "assessed", results: "assessed" },
        }).success,
      ).toBe(true);
    }
    expect(shotSubtypes.find((s) => s.id === "hit_and_stay")?.standard).toBe(
      "Hit & Stay",
    );
    for (const id of ["hit_and_roll_away", "hit_and_roll_under"])
      expect(shotSubtypes.find((s) => s.id === id)?.standard).toBe(
        "Hit & Roll",
      );
  });
  it("filters both weight pickers and result observations, and falls back to all in Standard or without a compatible subtype", () => {
    expect(entryChoices("Guard/Front Stone", "guard", true)).toEqual({
      weights: ["1_guard", "2_guard", "3_guard"],
      results: ["light", "heavy", "hog", "in_house"],
    });
    for (const args of [
      ["Draw", "", true],
      ["Draw", "guard", true],
      ["Guard/Front Stone", "guard", false],
    ] as const)
      expect(entryChoices(args[0], args[1], args[2])).toEqual({
        weights: allWeights,
        results: allResults,
      });
  });
  it("preserves hidden historical observations on correction and distinguishes cleared from explicit no miss", () => {
    const old = supplementSchema.parse({
      ...emptySupplement(),
      values: {
        detail: "open_draw",
        intendedWeight: "back_button",
        contactPlan: "no_intended_stone_contact",
        guardToClear: "yes",
        tolerance: "tight",
        toleranceResult: "within_called_tolerance",
        observedWeight: "heavy",
        missOther: "Historical note",
      },
      assessments: { tolerance: "assessed", weight: "assessed" },
    });
    let next = changeObservation(old, "observedDestination", "button");
    next = changeObservation(next, "resultObservations", ["light", "wreck"]);
    expect(supplementSchema.parse(next).values).toMatchObject(old.values);
    next = changeObservation(next, "resultObservations", []);
    expect(next.assessments.results).toBe("assessed");
    expect(next.values.resultObservations).toEqual([]);
    next = changeObservation(next, "resultObservations", undefined);
    expect(next.assessments.results).toBe("not_assessed");
    expect(next.values.resultObservations).toBeUndefined();
    expect(supplementSchema.parse(next).values).toMatchObject(old.values);
    expect(
      supplementSchema.safeParse({
        ...next,
        values: { ...next.values, observedDestination: "arbitrary" },
      }).success,
    ).toBe(false);
  });
});
