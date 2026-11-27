import definitions from "./shot-subtypes.json";
import type { Shot } from "./model";

/** Reviewed workbook snapshot. IDs are separate from the original Enhanced detail codes. */
export const shotSubtypes = definitions.subtypes;
export const weightLabels: Record<string, string> = definitions.weights;
export const resultLabels: Record<string, string> = definitions.results;
export const allWeights = Object.keys(weightLabels);
export const allResults = Object.keys(resultLabels);
export function subtypeFor(type: Shot["type"], id: unknown) {
  return shotSubtypes.find((s) => s.id === id && s.standard === type);
}
export function entryChoices(
  _type: Shot["type"],
  _id: unknown,
  _enhanced: boolean,
) {
  return {
    weights: allWeights,
    results: allResults,
  };
}
