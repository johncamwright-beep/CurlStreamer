import { z } from "zod";
import { currentShots, type State } from "./model";

export const localReviewSchema = z
  .object({
    version: z.literal(1),
    id: z.uuid(),
    gameId: z.uuid(),
    audience: z.enum(["player", "team"]),
    notes: z.string().max(2000),
    selectedAt: z.iso.datetime(),
    capturedAt: z.iso.datetime(),
    timingEstimated: z.literal(true),
  })
  .strict()
  .refine((value) => {
    const age = Date.parse(value.capturedAt) - Date.parse(value.selectedAt);
    return age >= 0 && age <= 125000;
  }, "Selected point is outside the captured window");
export const localReviewSaveSchema = z
  .object({
    review: localReviewSchema,
    shotId: z.uuid().nullable(),
    playerId: z.string().min(1).max(100).optional(),
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export function localReviewCommand(
  state: State,
  input: z.infer<typeof localReviewSaveSchema>,
) {
  if (!input.shotId) throw Error("Select a recorded shot");
  const previous = state.events.find(
    (event) => event.requestId === input.review.id,
  );
  if (previous) {
    if (
      previous.shotId !== input.shotId ||
      previous.expectedRevision !== input.expectedRevision ||
      previous.shot?.flaggedAt !== input.review.selectedAt ||
      previous.shot?.flagAudience !== input.review.audience ||
      previous.shot?.note !== input.review.notes
    )
      throw Error("Review request already used");
    return {
      requestId: previous.requestId,
      expectedRevision: previous.expectedRevision,
      shotId: previous.shotId,
      shot: previous.shot,
    };
  }
  if (state.status === "closed")
    throw Error("Reopen this game before adding a flag");
  const existing = currentShots(state.events).find(
    (shot) => shot.id === input.shotId,
  );
  if (!existing) throw Error("Recorded shot not found");
  const { id: shotId, ...shot } = existing;
  return {
    requestId: input.review.id,
    expectedRevision: input.expectedRevision,
    shotId,
    shot: {
      ...shot,
      flagged: true,
      flagAudience: input.review.audience,
      flaggedAt: input.review.selectedAt,
      note: input.review.notes,
      videoReview: {
        url: "",
        positionSeconds: null,
        lookBackSeconds: 0,
        estimated: true,
      },
    },
  };
}
