import { describe, expect, it } from "vitest";
import { emptySupplement, supplementSchema } from "./enhanced-catalog";
import { replaceEntryMisses } from "./entry-selection";
import { changeObservation, resultRelevant } from "./result-entry";
import { assessmentCoverage } from "./assessment-coverage";
import { standardShot } from "@/test/enhanced-fixtures";
import type { EnhancedDocument } from "../providers/shot-tracker-enhanced";

describe("explicit result entry", () => {
  it("assesses zero removals and can clear them without inferring success", () => {
    const initial = emptySupplement();
    initial.values.intendedTargets = 2;
    const recorded = changeObservation(initial, "removedTargets", 0);
    expect(recorded.assessments.removal).toBe("assessed");
    expect(recorded.values.removedTargets).toBe(0);
    expect(supplementSchema.safeParse(recorded).success).toBe(true);
    const cleared = changeObservation(recorded, "removedTargets", undefined);
    expect(cleared.assessments.removal).toBe("not_assessed");
    expect(cleared.values.removedTargets).toBeUndefined();
    expect(supplementSchema.safeParse(cleared).success).toBe(true);
    expect(initial.values).toEqual({ intendedTargets: 2 });
  });
  it("reuses explicit contact results and clears their synonymous misses", () => {
    const initial = replaceEntryMisses(emptySupplement(), [
      "contact_too_thick",
      "failed_to_bury",
    ]);
    const missed = changeObservation(
      initial,
      "contactResult",
      "intended_first_contact_missed",
    );
    expect(missed.values.misses).toEqual([
      "failed_to_bury",
      "flash_with_side_unclear",
    ]);
    const narrow = replaceEntryMisses(missed, ["flash_narrow"]);
    expect(
      changeObservation(
        narrow,
        "contactResult",
        "intended_first_contact_missed",
      ).values.misses,
    ).toEqual(["flash_narrow"]);
    const cleared = changeObservation(narrow, "contactResult", undefined);
    expect(cleared.values.misses).toBeUndefined();
    expect(cleared.assessments.misses).toBe("not_assessed");
    for (const value of [initial, missed, narrow, cleared])
      expect(supplementSchema.safeParse(value).success).toBe(true);
  });
  it("corrects roll observations in both directions without leaving stale miss results", () => {
    const initial = changeObservation(
      emptySupplement(),
      "rollResult",
      "too_far",
    );
    expect(initial.values.misses).toEqual(["roll_too_far"]);
    const corrected = changeObservation(
      initial,
      "rollResult",
      "wrong_direction",
    );
    expect(corrected.values.misses).toEqual(["roll_wrong_direction"]);
    const good = changeObservation(corrected, "rollResult", "as_called");
    expect(good.assessments.roll).toBe("assessed");
    expect(good.assessments.misses).toBe("not_assessed");
    expect(good.values.misses).toBeUndefined();
    const cleared = changeObservation(good, "rollResult", undefined);
    expect(cleared.assessments.roll).toBe("not_assessed");
    for (const value of [initial, corrected, good, cleared])
      expect(supplementSchema.safeParse(value).success).toBe(true);
  });
  it("requires an explicit No observed miss selection, never inferring it from successful contact", () => {
    const made = changeObservation(
      emptySupplement(),
      "contactResult",
      "intended_first_contact_made",
    );
    expect(made.assessments.misses).toBeUndefined();
    const none = replaceEntryMisses(made, []);
    expect(none.values.misses).toEqual([]);
    expect(none.assessments.misses).toBe("assessed");
    expect(none.assessments.technical).toBeUndefined();
    expect(supplementSchema.safeParse(none).success).toBe(true);
  });
  it("preserves hidden historical values and metadata on unrelated edits and clearing weight", () => {
    const original = emptySupplement();
    Object.assign(original.values, {
      tolerance: "tight",
      toleranceResult: "outside_called_tolerance",
      weightBasis: "timing",
      contactResult: "approach_interrupted_before_intended_contact",
      instruction: "Same weight",
      observedWeight: "heavy",
    });
    original.assessments = {
      tolerance: "assessed",
      contact: "assessed",
      weight: "assessed",
      removal: "not_applicable",
    };
    original.definitionRevision = 7;
    const corrected = changeObservation(original, "intendedWeight", "button");
    expect(corrected.values).toEqual({
      ...original.values,
      intendedWeight: "button",
    });
    expect(corrected.assessments).toEqual(original.assessments);
    const cleared = changeObservation(corrected, "observedWeight", undefined);
    expect(cleared.values.weightBasis).toBe("timing");
    expect(cleared.values.toleranceResult).toBe("outside_called_tolerance");
    expect(cleared.definitionRevision).toBe(7);
    expect(supplementSchema.safeParse(cleared).success).toBe(true);
    expect(original.values.intendedWeight).toBeUndefined();
  });
  it("uses explicit call relevance, never categories, outcomes, or guessed guard opportunities", () => {
    const values = { detail: "double_takeout" };
    for (const key of ["contactResult", "rollResult", "removedTargets"])
      expect(resultRelevant(values, key)).toBe(false);
    expect(
      resultRelevant(
        { contactPlan: "direct_contact_with_target" },
        "contactResult",
      ),
    ).toBe(true);
    expect(
      resultRelevant({ intendedRoll: "no_roll_requirement" }, "rollResult"),
    ).toBe(false);
    expect(resultRelevant({ intendedRoll: "stay_or_nose" }, "rollResult")).toBe(
      true,
    );
    expect(resultRelevant({ intendedTargets: 0 }, "removedTargets")).toBe(
      false,
    );
    expect(resultRelevant({ intendedTargets: 2 }, "removedTargets")).toBe(true);
    expect(values).not.toHaveProperty("guardToClear");
  });
});

describe("assessment coverage", () => {
  it("separates explicit none, unknowns, missing calls, exclusions and conflicts", () => {
    const assessed = replaceEntryMisses(emptySupplement(), []);
    Object.assign(assessed.values, {
      observedWeight: "on_target",
      contactPlan: "direct_contact_with_target",
      contactResult: "intended_first_contact_made",
      intendedTargets: 2,
      removedTargets: 0,
    });
    Object.assign(assessed.assessments, {
      weight: "assessed",
      contact: "assessed",
      removal: "assessed",
    });
    const doc: EnhancedDocument = {
      kind: "supplement",
      shotId: "a",
      value: assessed,
      revision: 1,
      sourceRevision: 1,
      at: "",
    };
    const shots = ["a", "b"].map((id) => ({
      ...standardShot,
      id,
      execution: "Make" as const,
      grade: 5,
    }));
    const excluded = {
      ...standardShot,
      id: "c",
      excluded: "Pick" as const,
      grade: null,
    };
    const rows = assessmentCoverage([...shots, excluded], [doc]);
    expect(rows.find((r) => r.group === "weight")).toMatchObject({
      eligible: 2,
      assessed: 1,
      unassessed: 1,
    });
    expect(rows.find((r) => r.group === "misses")).toMatchObject({
      eligible: 2,
      assessed: 1,
    });
    expect(rows.find((r) => r.group === "contact")).toMatchObject({
      eligible: 1,
      assessed: 1,
      unknownCall: 1,
    });
    expect(rows.find((r) => r.group === "removal")).toMatchObject({
      eligible: 1,
      assessed: 1,
      unknownCall: 1,
    });
    const destinations = changeObservation(
      assessed,
      "observedDestination",
      "button",
    );
    const explicitNone = changeObservation(
      destinations,
      "resultObservations",
      [],
    );
    const newRows = assessmentCoverage(
      [...shots, excluded],
      [{ ...doc, value: explicitNone }],
    );
    for (const group of ["destination", "results"]) {
      expect(newRows.find((r) => r.group === group)).toMatchObject({
        eligible: 2,
        assessed: 1,
        unassessed: 1,
      });
    }
    const unassessed = changeObservation(
      explicitNone,
      "resultObservations",
      undefined,
    );
    expect(
      assessmentCoverage(shots, [{ ...doc, value: unassessed }]).find(
        (r) => r.group === "results",
      ),
    ).toMatchObject({ assessed: 0, unassessed: 2 });
    const conflicted = assessmentCoverage(shots, [
      { ...doc, conflicts: ["source identity requires reconciliation"] },
    ]);
    expect(conflicted.find((r) => r.group === "weight")).toMatchObject({
      assessed: 0,
      needsReview: 1,
    });
    expect(conflicted.find((r) => r.group === "contact")).toMatchObject({
      eligible: 0,
      unknownCall: 2,
    });
    expect(assessmentCoverage(shots, []).every((r) => r.assessed === 0)).toBe(
      true,
    );
  });
});
