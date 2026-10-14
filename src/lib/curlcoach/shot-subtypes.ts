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
  type: Shot["type"],
  id: unknown,
  enhanced: boolean,
) {
  const subtype = enhanced ? subtypeFor(type, id) : undefined;
  return {
    weights: subtype?.weights ?? allWeights,
    results: subtype?.results ?? allResults,
  };
}
