import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { selectStoreProvider } from "./store-selection";
import type { GameState } from "@/lib/types";
import {
  readGameCompletionSummary,
  type SafeGameCompletion,
} from "@/lib/game-completion";

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
  return { kind: "active", game: row.state as GameState };
}
