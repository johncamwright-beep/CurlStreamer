import { z } from "zod";
import type { SafeGameCompletion } from "./game-completion";

export const completedEndSchema = z
  .object({
    end: z.number().int().min(1).max(30),
    team: z.enum(["home", "away"]).nullable(),
    points: z.number().int().min(0).max(8),
    blank: z.boolean(),
  })
  .strict()
  .refine(
    (end) =>
      end.blank
        ? end.team === null && end.points === 0
        : end.team !== null && end.points > 0,
    "A blank end must have no team or points; a scored end needs a team and points.",
  );

export const completedResultCorrectionSchema = z
  .object({
    requestId: z.string().uuid(),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER),
    ends: z.array(completedEndSchema).max(30),
    reason: z.string().trim().min(1).max(500),
  })
  .strict()
  .refine(
    ({ ends }) => ends.every((end, index) => end.end === index + 1),
    "Ends must be in order, starting at End 1, without gaps.",
  );

export type CompletedResultCorrection = z.infer<
  typeof completedResultCorrectionSchema
>;
export type CompletedResultSnapshot = {
  completion: SafeGameCompletion;
  revision: number;
};
