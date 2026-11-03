export type AnalysisOrder = "descending" | "ascending" | "name";

/** Missing measurements stay last in either direction; zero is a measurement. */
export function rankAnalysis<T>(
  rows: readonly T[],
  order: AnalysisOrder,
  value: (row: T) => number | null,
  label: (row: T) => string,
): T[] {
  return [...rows].sort((a, b) => {
    const names = label(a).localeCompare(label(b));
    if (order === "name") return names;
    const av = value(a),
      bv = value(b);
    const missingA = av === null || !Number.isFinite(av);
    const missingB = bv === null || !Number.isFinite(bv);
    if (missingA || missingB)
      return Number(missingA) - Number(missingB) || names;
    return (order === "ascending" ? av! - bv! : bv! - av!) || names;
  });
}
