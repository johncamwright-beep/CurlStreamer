import { roster, type Shot } from "./model";
const positions = ["Lead", "Second", "Third", "Fourth"] as const;
/** Advance only our charted team's turns; opponents' stones are not entered here. */
export function nextTurn(shot: Shot, recorded: Shot[]): Shot | null {
  const index = positions.indexOf(shot.position);
  const nextIndex = shot.stone === 1 ? index : (index + 1) % positions.length;
  const end = shot.end + (shot.stone === 2 && index === 3 ? 1 : 0);
  if (end > 20) return null;
  const position = positions[nextIndex];
  const playerId =
    position === shot.position
      ? shot.playerId
      : ([...recorded]
          .reverse()
          .find(
            (attempt) => attempt.position === position && attempt.end <= end,
          )?.playerId ?? roster[nextIndex].id);
  return {
    playerId,
    position,
    end,
    stone: shot.stone === 1 ? 2 : 1,
    type: null,
    turn: null,
    execution: null,
    grade: null,
    deficiency: null,
    review: null,
    excluded: null,
    note: "",
    flagged: false,
    ...(shot.videoReview
      ? { videoReview: { ...shot.videoReview, positionSeconds: null } }
      : {}),
  };
}
