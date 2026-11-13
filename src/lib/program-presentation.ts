import { z } from "zod";

export const programCompletionSchema = z.object({
  homeName: z.string().max(200),
  awayName: z.string().max(200),
  eventName: z.string().max(300),
  result: z.object({
    outcome: z.enum(["no_result", "tie", "home_win", "away_win"]),
    label: z.string().max(300),
    totals: z
      .object({
        home: z.number().int().nonnegative(),
        away: z.number().int().nonnegative(),
      })
      .nullable(),
  }),
});
export const programPresentationSchema = z.object({
  generation: z.number().int().nonnegative(),
  mode: z.enum(["live", "hold", "preparing-end", "ended"]),
  completion: programCompletionSchema.optional(),
  holdPicture: z.boolean().optional(),
  deadlineAt: z.number().finite().optional(),
});
export type ProgramPresentation = z.infer<typeof programPresentationSchema>;
export type ProgramCompletion = z.infer<typeof programCompletionSchema>;

export const programClosingGrantSchema = z
  .object({
    sessionId: z.uuid(),
    generation: z.number().int().positive(),
    intentId: z.uuid(),
    deadlineAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type ProgramClosingGrant = z.infer<typeof programClosingGrantSchema>;
