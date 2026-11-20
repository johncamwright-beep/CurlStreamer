import {
  catalogue,
  emptySupplement,
  selectMisses,
  type Supplement,
} from "@/lib/curlcoach/enhanced-catalog";
import type { Shot } from "@/lib/curlcoach/model";
export const standardShot: Shot = {
  playerId: "lead",
  position: "Lead",
  end: 1,
  stone: 1,
  type: "Draw",
  turn: "CW C",
  execution: "Partial",
  grade: 0,
  deficiency: null,
  line: "Wide",
  release: "Neutral",
  technical: null,
  review: null,
  excluded: null,
  note: "Original note",
  flagged: true,
  videoReview: {
    url: "https://www.youtube.com/watch?v=abcdefghijk",
    positionSeconds: 132,
    lookBackSeconds: 30,
  },
};
export function optionFixture(
  key: string,
  choice: string | number | string[],
): Supplement {
  let s = emptySupplement();
  s.values[key] = choice;
  const group = catalogue[key].group;
  if (group)
    s.assessments[group as keyof Supplement["assessments"]] = "assessed";
  if (key === "misses" || key === "primaryMiss")
    s = selectMisses(s, Array.isArray(choice) ? choice : [String(choice)]);
  if (key === "contactResult" && choice === "intended_first_contact_missed")
    s = selectMisses(s, ["flash_with_side_unclear"]);
  if (key === "primaryMiss") s.values.primaryMiss = choice;
  if (s.values.detail === "other_detail")
    s.values.detailOther = "Recorded detail";
  if (s.values.weightBasis === "other_recorded_basis")
    s.values.weightBasisOther = "Recorded basis";
  if (s.values.rollResult === "other_recorded_result")
    s.values.rollOther = "Recorded roll";
  if (
    (s.values.misses as string[] | undefined)?.includes("other_observable_miss")
  )
    s.values.missOther = "Observable miss";
  if (s.values.removedTargets !== undefined) s.values.intendedTargets = 15;
  if (s.values.toleranceResult) s.values.tolerance = "normal";
  if (s.values.directionOverride)
    s.values.directionReason = "Recorded override";
  if (s.values.conditionsChanged === "new_ice_segment")
    Object.assign(s.values, {
      iceSegment: "After scrape",
      conditionsNote: "Scrape",
      conditionsAt: "2026-10-12T15:00:00Z",
    });
  if (key === "conditionsAt") s.values[key] = "2026-10-12T15:00:00Z";
  if (s.values.adjustmentDecision)
    Object.assign(s.values, {
      earlierShotId: "10000000-0000-4000-8000-000000000001",
      instruction: "Hold weight",
      adjustmentTypes: ["changed_broom_or_called_ice"],
    });
  if (
    key === "adjustmentTypes" &&
    (choice as string[]).includes("other_recorded_change")
  )
    s.values.adjustmentOther = "Recorded change";
  if (key === "earlierShotId" || key === "followUpShotId")
    s.values[key] = "10000000-0000-4000-8000-000000000001";
  return s;
}
