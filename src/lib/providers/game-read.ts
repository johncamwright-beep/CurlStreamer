import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { selectStoreProvider } from "./store-selection";
import type { GameState } from "@/lib/types";
import {
  readGameCompletionSummary,
  type SafeGameCompletion,
} from "@/lib/game-completion";

const logoCache = new Map<string, { expires: number; url?: string }>();
function validTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
const broadcastScheduleSchema = z
  .object({
    scheduledStart: z.string().datetime({ offset: true }),
    timezone: z.string().trim().min(1).max(100).refine(validTimezone),
  })
  .strict();

export type GameRead =
  | { kind: "active"; game: GameState }
  | { kind: "completed"; completion: SafeGameCompletion }
  | { kind: "not-found" | "deleted" | "closed" };

/** Lifecycle and state come from one snapshot; deleted state is never returned. */
export async function readGame(id: string): Promise<GameRead> {
  if (selectStoreProvider() === "local") {
    const { getGame } = await import("./local-store");
    const game = getGame(id);
    if (!game) return { kind: "not-found" };
    if (game.status === "closed") return { kind: "closed" };
    if (game.status === "completed") return { kind: "closed" };
    return { kind: "active", game };
  }
  // Mock game ids remain readable in development, but are not database UUIDs.
  if (!z.uuid().safeParse(id).success) return { kind: "not-found" };
  const { data, error } = await createAdminSupabaseClient().rpc(
    "read_game_state",
    {
      p_game_id: id,
    },
  );
  if (error || !Array.isArray(data)) throw new Error("Game read unavailable");
  const row = data[0];
  if (!row) return { kind: "not-found" };
  if (row.outcome === "deleted") return { kind: "deleted" };
  if (row.outcome === "closed") {
    const completion = await readGameCompletionSummary(id);
    return completion ? { kind: "completed", completion } : { kind: "closed" };
  }
  if (row.outcome !== "active" || !row.state)
    throw new Error("Game read unavailable");
  // JSON state is mutable and may retain a stale/forged copy. Schedule display
  // metadata comes exclusively from the canonical games row in this RPC.
  const { broadcastSchedule: _storedSchedule, ...state } =
    row.state as GameState;
  const scheduledStart = row.scheduled_start ?? null;
  const timezone = row.schedule_timezone ?? null;
  const schedule = broadcastScheduleSchema.safeParse({
    scheduledStart,
    timezone,
  });
  const game = {
    ...state,
    ...(schedule.success ? { broadcastSchedule: schedule.data } : {}),
  };
  let logo = logoCache.get(id);
  if (!logo || logo.expires < Date.now()) {
    const result = await Promise.resolve(
      createAdminSupabaseClient().rpc("read_game_team_logo", { p_game: id }),
    ).catch(() => ({ data: null }));
    logo = {
      expires: Date.now() + 60_000,
      url:
        typeof result.data === "string" && result.data.startsWith("https://")
          ? result.data
          : undefined,
    };
    if (logoCache.size > 500) logoCache.clear();
    logoCache.set(id, logo);
  }
  if (logo.url) game.config = { ...game.config, homeLogoUrl: logo.url };
  return { kind: "active", game };
}
