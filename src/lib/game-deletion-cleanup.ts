import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { terminateGameLiveKit } from "@/lib/providers/livekit";
import { listCameraIdentityGenerations } from "@/lib/store";
import { stopGameBroadcast } from "@/lib/broadcast-session";
import type { CompletionCredential } from "@/lib/game-completion";
export type Cleanup = {
  status: "pending" | "failed" | "complete";
  attempts: number;
  lastError: string | null;
};

function cleanupRow(value: Record<string, unknown>): Cleanup {
  return {
    status: value.status as Cleanup["status"],
    attempts: Number(value.attempts),
    lastError: (value.last_error as string | null) ?? null,
  };
}

export async function cleanupDeletedGame(
  database: ReturnType<typeof createAdminSupabaseClient>,
  userId: string,
  gameId: string,
  authority: CompletionCredential,
) {
  const parameters = { p_user_id: userId, p_game_id: gameId };
  const current = await database.rpc("get_game_deletion_cleanup", parameters);
  if (current.error) return { kind: "unavailable" as const };
  const existing = (current.data as Record<string, unknown>[] | null)?.[0];
  if (!existing) return { kind: "not-found" as const };
  const cleanup = cleanupRow(existing);
  if (cleanup.status === "complete")
    return { kind: "recorded" as const, cleanup };

  const providerErrors: string[] = [];
  try {
    const broadcast = await stopGameBroadcast(gameId, authority);
    if (!["idle", "stopped"].includes(broadcast.status))
      throw new Error("not stopped");
  } catch {
    providerErrors.push("YouTube broadcast shutdown was not confirmed");
  }
  try {
    const generations = await listCameraIdentityGenerations(gameId);
    await terminateGameLiveKit(gameId, generations);
  } catch {
    providerErrors.push("LiveKit room shutdown was not confirmed");
  }
  const providerError = providerErrors.join("; ") || undefined;
  const recorded = await database.rpc("record_game_deletion_cleanup", {
    ...parameters,
    p_succeeded: !providerError,
    p_error: providerError ?? null,
  });
  const row = (recorded.data as Record<string, unknown>[] | null)?.[0];
  if (recorded.error || !row) return { kind: "unavailable" as const };
  return { kind: "recorded" as const, cleanup: cleanupRow(row) };
}
