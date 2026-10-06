import { deficiencies, type Shot } from "./model";
import { family, type CoachGame } from "./event";
import { observedEnds } from "./score-statistics";

export type AnalysisShot = Shot & { id: string; gameId: string };
export type ShotFilters = {
  type: string;
  turn: string;
  end: string;
  hammer: string;
  margin: string;
};
export const defaultShotFilters: ShotFilters = {
  type: "all",
  turn: "all",
  end: "all",
  hammer: "all",
  margin: "all",
};
export function filterAnalysisShots(
  shots: AnalysisShot[],
  games: CoachGame[],
  filters: ShotFilters,
) {
  const observations = new Map(games.map((g) => [g.id, observedEnds(g)]));
  return shots.filter((s) => {
    const end = observations.get(s.gameId)?.find((e) => e.end === s.end);
    return (
      (filters.type === "all" ||
        s.type === filters.type ||
        family(s) === filters.type) &&
      (filters.turn === "all" || s.turn === filters.turn) &&
      (filters.end === "all" || s.end === Number(filters.end)) &&
      (filters.hammer === "all" ||
        (end?.hammer != null && end.hammer === (filters.hammer === "with"))) &&
      (filters.margin === "all" ||
        (end?.difference != null &&
          Math.max(-4, Math.min(4, end.difference)) === Number(filters.margin)))
    );
  });
}
/** Diagnoses and numeric grades are independent inputs. Never infer a diagnosis from a low grade. */
export function missBreakdown(shots: Shot[]) {
  const diagnosed = shots.filter((s) => !s.excluded && s.deficiency !== null);
  const misses = diagnosed.filter((s) => s.deficiency !== "Make");
  return deficiencies
    .filter((d) => d !== "Make")
    .map((label) => {
      const count = misses.filter((s) => s.deficiency === label).length;
      return {
        label,
        count,
        share: misses.length ? (count / misses.length) * 100 : null,
        frequency: diagnosed.length ? (count / diagnosed.length) * 100 : null,
      };
    });
}
