import {
  catalogue,
  type groups,
  type Supplement,
  type Values,
} from "./enhanced-catalog";
import { replaceEntryMisses } from "./entry-selection";

const contactMiss = (m: string) => /^(flash_|wreck_|contact_too_)/.test(m);
const rollMiss = (m: string) =>
  m.startsWith("roll_") || m === "shooter_lost_when_intended_to_stay";
const rollMisses: Record<string, string> = {
  too_far: "roll_too_far",
  not_far_enough: "roll_not_far_enough",
  wrong_direction: "roll_wrong_direction",
  shooter_lost: "shooter_lost_when_intended_to_stay",
};

/** The call, never the shot category or grade, establishes an opportunity. */
export function resultRelevant(values: Values, key: string): boolean {
  if (key === "contactResult")
    return [
      "direct_contact_with_target",
      "raise_or_runback_through_first_stone",
    ].includes(String(values.contactPlan));
  if (key === "rollResult" || key === "rollOther")
    return (
      !!values.intendedRoll && values.intendedRoll !== "no_roll_requirement"
    );
  if (key === "removedTargets")
    return (
      typeof values.intendedTargets === "number" && values.intendedTargets > 0
    );
  return true;
}

/** Edits only this observation and synonymous miss facts; retains hidden history. */
export function changeObservation(
  s: Supplement,
  key: string,
  entry: Values[string] | undefined,
): Supplement {
  let next: Supplement = {
    ...s,
    values: { ...s.values },
    assessments: { ...s.assessments },
  };
  if (key === "contactResult" || key === "rollResult") {
    const old = (s.values.misses ?? []) as string[];
    const related = key === "contactResult" ? contactMiss : rollMiss;
    let compatible: string[] = [];
    if (key === "contactResult") {
      const prefix =
        entry === "intended_first_contact_missed"
          ? "flash_"
          : entry === "intended_first_contact_made"
            ? "contact_too_"
            : entry === "approach_interrupted_before_intended_contact"
              ? "wreck_"
              : null;
      compatible = prefix ? old.filter((m) => m.startsWith(prefix)) : [];
      if (entry === "intended_first_contact_missed" && !compatible.length)
        compatible = ["flash_with_side_unclear"];
    } else if (rollMisses[String(entry)])
      compatible = [rollMisses[String(entry)]];
    const misses = [...old.filter((m) => !related(m)), ...compatible];
    if (old.some(related) || compatible.length) {
      // Removing the last known miss does not establish that no other miss occurred.
      next = replaceEntryMisses(
        next,
        misses,
        String(s.values.primaryMiss ?? ""),
        misses.length ? "assessed" : "not_assessed",
      );
    }
    if (key === "rollResult" && entry !== "other_recorded_result")
      delete next.values.rollOther;
  }
  if (entry === undefined) delete next.values[key];
  else next.values[key] = entry;
  const group = catalogue[key]?.group as (typeof groups)[number] | undefined;
  if (group)
    next.assessments[group] = entry === undefined ? "not_assessed" : "assessed";
  return next;
}
