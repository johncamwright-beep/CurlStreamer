import { shotTypes, type Shot } from "./model";
import {
  detailMappings,
  selectMisses,
  type Supplement,
} from "./enhanced-catalog";

/** A single visible choice; Standard remains the compatibility classification. */
export function selectEntryShot(
  shot: Shot,
  supplement: Supplement,
  choice: string,
  editing: boolean,
) {
  const next = { ...supplement, values: { ...supplement.values } };
  delete next.values.detail;
  delete next.values.detailOther;
  if (choice.startsWith("standard:")) {
    const type = choice.slice(9) as Shot["type"];
    if (!shotTypes.includes(type!)) throw new Error("Unknown shot selection");
    return { shot: { ...shot, type }, supplement: next };
  }
  if (!choice) return { shot: { ...shot, type: null }, supplement: next };
  const detail = choice.replace(/^enhanced:/, "");
  if (!(detail in detailMappings)) throw new Error("Unknown shot selection");
  next.values.detail = detail;
  if (detail === "other_detail" && supplement.values.detailOther)
    next.values.detailOther = supplement.values.detailOther;
  return {
    shot: {
      ...shot,
      type: editing ? shot.type : detailMappings[detail],
    },
    supplement: next,
  };
}

/** Removing a miss also clears its corresponding result, never unrelated observations. */
export function replaceEntryMisses(
  s: Supplement,
  misses: string[],
  primary?: string,
  state: "assessed" | "not_assessed" | "not_applicable" = "assessed",
): Supplement {
  const next = {
    ...s,
    values: { ...s.values },
    assessments: { ...s.assessments },
  };
  const old = (s.values.misses ?? []) as string[];
  const contact = (m: string) =>
    m.startsWith("flash_") ||
    m.startsWith("wreck_") ||
    m.startsWith("contact_too_");
  const roll = (m: string) =>
    m.startsWith("roll_") || m === "shooter_lost_when_intended_to_stay";
  for (const [group, test, key] of [
    ["contact", contact, "contactResult"],
    ["roll", roll, "rollResult"],
  ] as const) {
    if (old.some(test) && !misses.some(test)) {
      delete next.values[key];
      if (group === "roll") delete next.values.rollOther;
      next.assessments[group] = "not_assessed";
    }
  }
  const result = selectMisses(next, [...new Set(misses)]);
  if (misses.length)
    result.values.primaryMiss =
      primary && misses.includes(primary) ? primary : misses[0];
  else delete result.values.primaryMiss;
  if (!misses.includes("other_observable_miss")) delete result.values.missOther;
  if (state !== "assessed") {
    delete result.values.misses;
    result.assessments.misses = state;
  }
  return result;
}
