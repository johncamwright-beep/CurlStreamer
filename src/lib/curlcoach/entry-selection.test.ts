import { describe, expect, it } from "vitest";
import { standardShot } from "@/test/enhanced-fixtures";
import { emptySupplement, supplementSchema } from "./enhanced-catalog";
import { selectEntryShot, replaceEntryMisses } from "./entry-selection";

describe("unified charting entry", () => {
  it("stores classic choices only in Standard and maps new Enhanced choices without touching other shot data", () => {
    const original = emptySupplement();
    const enhanced = selectEntryShot(
      standardShot,
      original,
      "enhanced:runback_double",
      false,
    );
    expect(enhanced.shot).toEqual({
      ...standardShot,
      type: "Runback/Multiple",
    });
    expect(enhanced.supplement.values.detail).toBe("runback_double");
    const classic = selectEntryShot(
      enhanced.shot,
      enhanced.supplement,
      "standard:Draw",
      false,
    );
    expect(classic.shot).toEqual(standardShot);
    expect(classic.supplement.values.detail).toBeUndefined();
    expect(original.values).toEqual({});
  });
  it("does not invent a Standard category for a new unmapped detail", () => {
    const result = selectEntryShot(
      standardShot,
      emptySupplement(),
      "enhanced:other_detail",
      false,
    );
    expect(result.shot.type).toBeNull();
    expect(result.supplement.values.detail).toBe("other_detail");
  });
  it("preserves the historical Standard classification during supplemental reclassification", () => {
    const result = selectEntryShot(
      standardShot,
      emptySupplement(),
      "enhanced:runback_double",
      true,
    );
    expect(result.shot).toEqual(standardShot);
    expect(result.supplement.values.detail).toBe("runback_double");
  });
  it("clears dependent contact and roll results when their misses are removed", () => {
    let s = replaceEntryMisses(
      emptySupplement(),
      ["flash_wide", "roll_too_far"],
      "flash_wide",
    );
    s.values.observedWeight = "heavy";
    s.assessments.weight = "assessed";
    s = replaceEntryMisses(s, ["flash_wide"]);
    expect(s.values.rollResult).toBeUndefined();
    expect(s.assessments.roll).toBe("not_assessed");
    s = replaceEntryMisses(s, [], undefined, "not_assessed");
    expect(s.values.contactResult).toBeUndefined();
    expect(s.values.misses).toBeUndefined();
    expect(s.values.observedWeight).toBe("heavy");
    expect(supplementSchema.safeParse(s).success).toBe(true);
  });
  it("distinguishes no observed miss from not assessed and retains a valid primary after correction", () => {
    const initial = replaceEntryMisses(emptySupplement(), ["flash_wide"]);
    const corrected = replaceEntryMisses(initial, ["flash_narrow"]);
    expect(corrected.values.primaryMiss).toBe("flash_narrow");
    expect(supplementSchema.safeParse(corrected).success).toBe(true);
    const none = replaceEntryMisses(corrected, []);
    expect(none.values.misses).toEqual([]);
    expect(none.assessments.misses).toBe("assessed");
    expect(none.values.primaryMiss).toBeUndefined();
    expect(supplementSchema.safeParse(none).success).toBe(true);
  });
});
