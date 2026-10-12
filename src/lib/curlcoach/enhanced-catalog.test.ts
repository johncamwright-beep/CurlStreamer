import { describe, expect, it } from "vitest";
import {
  catalogue,
  contextSchema,
  deliveryDirection,
  emptySupplement,
  selectMisses,
  setupCatalogue,
  standardConflicts,
  suggestStandard,
  supplementSchema,
} from "./enhanced-catalog";
import {
  append,
  currentShots,
  emptyState,
  report,
  shotSchema,
  type Shot,
} from "./model";
import { supplementConflicts } from "@/lib/providers/shot-tracker-enhanced";
import { standardShot, optionFixture } from "@/test/enhanced-fixtures";
describe("versioned Enhanced capture", () => {
  it("rejects wrong field types without throwing outside Zod validation", () => {
    for (const values of [
      { misses: "flash_wide" },
      { misses: 2 },
      { intendedWeight: [] },
      { adjustmentTypes: 5 },
      { removedTargets: "1" },
      { nonexistent: "value" },
    ]) {
      expect(
        supplementSchema.safeParse({ ...emptySupplement(), values }).success,
      ).toBe(false);
    }
  });
  for (const [key, f] of Object.entries(catalogue))
    for (const choice of f.choices ?? [f.number ? f.max! : f.example])
      it(`round trips ${key}: ${choice}`, () => {
        const s = optionFixture(key, f.multiple ? [String(choice)] : choice);
        expect(supplementSchema.parse(JSON.parse(JSON.stringify(s)))).toEqual(
          s,
        );
      });
  for (const [key, f] of Object.entries(setupCatalogue))
    for (const choice of f.choices ?? [f.number ? f.max! : f.example])
      it(`persists setup ${key}: ${choice}`, () =>
        expect(contextSchema.parse({ [key]: choice })).toEqual({
          [key]: choice,
        }));
  it("keeps unknown, explicit empty and not applicable distinct", () => {
    expect(
      supplementSchema.parse(emptySupplement()).assessments.misses,
    ).toBeUndefined();
    expect(
      supplementSchema.parse(selectMisses(emptySupplement(), [])).values.misses,
    ).toEqual([]);
    const s = emptySupplement();
    s.assessments.misses = "not_applicable";
    expect(supplementSchema.parse(s).values.misses).toBeUndefined();
    s.assessments.misses = "assessed";
    expect(supplementSchema.safeParse(s).success).toBe(false);
  });
  it("rejects interrupted flashes and opposing directions", () => {
    for (const details of [
      ["wreck_on_guard", "flash_wide"],
      ["flash_wide", "flash_narrow"],
      ["contact_too_thin", "contact_too_thick"],
    ]) {
      const s = selectMisses(emptySupplement(), details);
      s.values.primaryMiss = details[0];
      expect(supplementSchema.safeParse(s).success).toBe(false);
    }
  });
  it("does not call intended runback contact a wreck", () => {
    const s = emptySupplement();
    s.values.contactPlan = "raise_or_runback_through_first_stone";
    s.values.contactResult = "intended_first_contact_made";
    s.assessments.contact = "assessed";
    expect(supplementSchema.parse(s).values.misses).toBeUndefined();
  });
  it("retains independent Standard outcomes, zero grades, exclusions and JSON export", () => {
    const fixtures = [
      standardShot,
      { ...standardShot, grade: 5 },
      { ...standardShot, grade: null },
      { ...standardShot, grade: null, excluded: "Pick" as const },
    ];
    const serialized = fixtures.map((s) => JSON.stringify(shotSchema.parse(s)));
    const enhanced = fixtures.map((s) => ({
      standard: s,
      supplemental: optionFixture("detail", "runback_double"),
    }));
    expect(report(enhanced.map((s) => s.standard))).toEqual({
      attempts: 4,
      scored: 2,
      missing: 1,
      excluded: 1,
      percent: 50,
    });
    expect(
      enhanced.map((s) => JSON.stringify(shotSchema.parse(s.standard))),
    ).toEqual(serialized);
  });
  it("suggests a category only for an empty new record", () => {
    expect(
      suggestStandard("double_peel", { ...standardShot, type: null }, false)
        .type,
    ).toBe("Peel");
    expect(
      suggestStandard(
        "double_peel",
        { ...standardShot, type: "Runback/Multiple" },
        true,
      ).type,
    ).toBe("Runback/Multiple");
    expect(suggestStandard("double_peel", standardShot, false).type).toBe(
      "Draw",
    );
  });
  it("flags affected observations after an older-client correction but ignores grade-only changes", () => {
    const shotId = "10000000-0000-4000-8000-000000000001";
    const first = append(
      emptyState(),
      {
        requestId: "10000000-0000-4000-8000-000000000002",
        expectedRevision: 0,
        shotId,
        shot: standardShot,
      },
      "coach",
    );
    const value = emptySupplement();
    value.assessments.line = "assessed";
    const doc = {
      kind: "supplement" as const,
      shotId,
      sourceRevision: 1,
      revision: 1,
      value,
      at: "",
    };
    const correct = (shot: Shot) =>
      append(
        first,
        {
          requestId: "10000000-0000-4000-8000-000000000003",
          expectedRevision: 1,
          shotId,
          shot,
        },
        "coach",
      );
    expect(
      supplementConflicts(doc, correct({ ...standardShot, grade: 4 })),
    ).toEqual([]);
    expect(
      supplementConflicts(doc, correct({ ...standardShot, line: "Tight" })),
    ).toEqual(["line"]);
    expect(currentShots(first.events)).toHaveLength(1);
    expect(standardConflicts(value, { ...standardShot, line: null })).toEqual([
      "line",
    ]);
  });
  it("never invents direction and alternates only a recorded first direction", () => {
    const s = emptySupplement();
    expect(deliveryDirection(s, 2)).toBeNull();
    s.contextSnapshot.firstDirection = "a_to_b";
    expect(deliveryDirection(s, 2)).toBe("b_to_a");
    s.values.directionOverride = "a_to_b";
    expect(deliveryDirection(s, 2)).toBe("a_to_b");
  });
});
