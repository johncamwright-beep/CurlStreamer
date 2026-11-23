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
  it("offers every weight and miss for every subtype", () => {
    expect(entryChoices("Guard/Front Stone", "guard", true)).toEqual({
      weights: allWeights,
      results: allResults,
    });
    expect(
      supplementSchema.safeParse({
        ...emptySupplement(),
        values: { shotSubtype: "guard", intendedWeight: "board" },
      }).success,
    ).toBe(true);
    for (const subtype of shotSubtypes)
      expect(
        entryChoices(
          subtype.standard as (typeof shotTypes)[number],
          subtype.id,
          true,
        ).results,
      ).toEqual(allResults);
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

it("validates new weights, broom/sweeping misses and positive feedback without altering legacy button IDs", () => {
  for (const weight of [
    "back_line",
    "just_through",
    "back_button",
    "biter",
    "button",
  ]) {
    const s = changeObservation(
      changeObservation(emptySupplement(), "intendedWeight", weight),
      "observedDestination",
      weight,
    );
    expect(supplementSchema.parse(s).values.observedDestination).toBe(weight);
  }
  const s = changeObservation(emptySupplement(), "resultObservations", [
    "not_enough_broom",
    "too_much_broom",
    "overswept",
    "missed_sweeping_call",
    "underswept",
  ]);
  s.values.positiveFeedback = [
    "individual_good_adjustment",
    "team_great_communication",
  ];
  s.values.positiveFeedbackNote = "Encouraging note";
  expect(supplementSchema.safeParse(s).success).toBe(true);
  expect(
    supplementSchema.safeParse({
      ...s,
      values: { ...s.values, positiveFeedback: ["invented"] },
    }).success,
  ).toBe(false);
  expect(
    supplementSchema.safeParse({
      ...s,
      values: { ...s.values, positiveFeedbackNote: "x".repeat(1001) },
    }).success,
  ).toBe(false);
});
