import "server-only";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { listTeamHierarchyGames } from "./team-hierarchy-service";
import type { GameNavigationMetadata } from "./game-entry";

const rowSchema = z.object({
  id: z.string(),
  scheduled_start: z
    .string()
    .refine((value) => Number.isFinite(Date.parse(value)))
    .nullable(),
  schedule_timezone: z.string().nullable(),
  game_number: z.number().int().positive().nullable(),
});

/** Only called on explicit navigation/retry after the account's game authorization. */
export async function readGameNavigationMetadata(
  user: User,
  gameId: string,
): Promise<GameNavigationMetadata> {
  try {
    const result = await listTeamHierarchyGames(user);
    if (!result.ok) return { state: "unavailable" };
    const candidate = result.value.find(
      (value) =>
        typeof value === "object" &&
        value !== null &&
        "id" in value &&
        value.id === gameId,
    );
    const parsed = rowSchema.safeParse(candidate);
    if (!parsed.success) return { state: "unavailable" };
    return {
      state: "available",
      scheduledStart: parsed.data.scheduled_start,
      timezone: parsed.data.schedule_timezone,
      gameNumber: parsed.data.game_number,
    };
  } catch {
    return { state: "unavailable" };
  }
}
