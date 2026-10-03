import type { Shot } from "./model";
export function isMiss(shot: Shot) {
  return (
    !shot.excluded &&
    ((shot.execution !== null && shot.execution !== "Make") ||
      (shot.grade !== null && shot.grade < 5) ||
      (shot.deficiency !== null && shot.deficiency !== "Make"))
  );
}
