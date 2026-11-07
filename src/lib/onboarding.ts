import { z } from "zod";

// Preferences only: authorization always comes from current team membership.
export const setupProgressSchema = z.object({
  organizationId: z.string().uuid(),
  step: z.number().int().min(1).max(6),
  complete: z.boolean().default(false),
  seasonId: z.string().uuid().optional(),
  eventId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
});
export type SetupProgress = z.infer<typeof setupProgressSchema>;
export function readSetupProgress(value: unknown, organizationId: string) {
  const parsed = setupProgressSchema.safeParse(value);
  return parsed.success && parsed.data.organizationId === organizationId
    ? parsed.data
    : null;
}
