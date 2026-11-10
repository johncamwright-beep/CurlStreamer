import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
import {
  standaloneReviewSchema,
  type StandaloneReview,
} from "@/lib/curlcoach/standalone-review";

export async function loadStandaloneReviews(
  account: CoachAccount,
  gameIds: string[],
) {
  const result: Record<string, StandaloneReview[]> = {};
  if (!gameIds.length) return result;
  const { data, error } = await createAdminSupabaseClient()
    .from("shot_tracker_standalone_reviews")
    .select(
      "request_id,game_id,audience,player_id,player_name,note,selected_at",
    )
    .eq("organization_id", account.organizationId)
    .eq("actor_user_id", account.userId)
    .in("game_id", gameIds)
    .order("created_at", { ascending: true });
  if (error?.code === "42P01" || error?.code === "PGRST205") return result;
  if (error) throw Error("Game reviews unavailable");
  for (const row of z
    .array(
      z.object({
        request_id: z.uuid(),
        game_id: z.uuid(),
        audience: z.enum(["player", "team"]),
        player_id: z.string().nullable(),
        player_name: z.string().nullable(),
        note: z.string(),
        selected_at: z.string(),
      }),
    )
    .parse(data)) {
    (result[row.game_id] ??= []).push(
      standaloneReviewSchema.parse({
        id: row.request_id,
        audience: row.audience,
        playerId: row.player_id,
        playerName: row.player_name,
        note: row.note,
        selectedAt: new Date(row.selected_at).toISOString(),
      }),
    );
  }
  return result;
}
