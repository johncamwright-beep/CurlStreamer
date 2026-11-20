import { z } from "zod";
import { eventLevels } from "./team-hierarchy";
export const opponentPositions = [
  "lead",
  "second",
  "third",
  "fourth",
  "alternate",
  "coach",
] as const;
const name = z.string().trim().max(100).default("");
export const opponentRosterSchema = z
  .object({
    lead: name,
    second: name,
    third: name,
    fourth: name,
    alternate: name,
    coach: name,
  })
  .strict();
export const opponentSeasonInputSchema = z
  .object({
    opponentId: z.uuid(),
    seasonId: z.uuid(),
    level: z.enum(eventLevels).nullable(),
    roster: opponentRosterSchema,
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export const opponentSeasonSchema = z.object({
  opponent_id: z.uuid(),
  season_id: z.uuid(),
  level: z.enum(eventLevels).nullable(),
  roster: opponentRosterSchema,
  revision: z.number().int().positive(),
});
export type OpponentSeason = z.infer<typeof opponentSeasonSchema>;
export type OpponentSeasonInput = z.infer<typeof opponentSeasonInputSchema>;
export const opponentSeasonDirectorySchema = z.object({
  profiles: z.array(opponentSeasonSchema),
  seasons: z.array(
    z.object({ id: z.uuid(), name: z.string(), status: z.string() }),
  ),
});
export type OpponentSeasonDirectory = z.infer<
  typeof opponentSeasonDirectorySchema
>;
