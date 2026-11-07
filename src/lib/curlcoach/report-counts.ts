import type { Evidence } from "./reports";
export type ReportBasis = {
  numerator: number;
  denominator: number;
  unit: "points" | "shots" | "ends";
  shots?: number;
};
export function basisText(basis: ReportBasis) {
  return `${basis.numerator} of ${basis.denominator} ${basis.unit}${basis.shots === undefined ? "" : `; ${basis.shots} ${basis.shots === 1 ? "shot" : "shots"}`}`;
}
export function evidenceBasis(e: Evidence) {
  if (e.basis) return basisText(e.basis);
  const ends = e.value.match(/^(\d+)\s*\/\s*(\d+) known-hammer ends/);
  if (ends) return `${ends[1]} of ${ends[2]} ends`;
  return `${e.sample} ${/graded|shooting|rotation/.test(e.value + e.label) || /^(overall|type-|turn-|game-.*(?:overall|type-|turn-))/.test(e.id) ? "graded shots" : "observations"}`;
}
export function countPercent(value: number | null, n: number, total: number) {
  return value === null
    ? "Not measured"
    : `${value.toFixed(1)}% (${n} of ${total})`;
}
