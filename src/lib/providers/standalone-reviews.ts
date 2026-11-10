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
  reviewId?: string,
) {
  const result: Record<string, StandaloneReview[]> = {};
  if (!gameIds.length) return result;
  const admin = createAdminSupabaseClient();
  let query = admin
    .from("shot_tracker_standalone_reviews")
    .select(
      "request_id,game_id,audience,player_id,player_name,note,selected_at",
    )
    .eq("organization_id", account.organizationId)
    .eq("actor_user_id", account.userId)
    .in("game_id", gameIds);
  if (reviewId) query = query.eq("request_id", reviewId);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error?.code === "42P01" || error?.code === "PGRST205") return result;
  if (error) throw Error("Game reviews unavailable");
  const rows = z
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
    .parse(data);
  if (!rows.length) return result;
  const { data: saved, error: correctionsError } = await admin.rpc(
    "read_standalone_review_corrections",
    {
      p_actor: account.userId,
      p_org: account.organizationId,
      p_games: [...new Set(rows.map((row) => row.game_id))],
    },
  );
  // Read the original bookmarks during an additive migration rollout.
  if (
    correctionsError &&
    correctionsError.code !== "42883" &&
    correctionsError.code !== "PGRST202"
  )
    throw Error("Game review corrections unavailable");
  const corrections = new Map(
    z
      .array(
        z.object({
          review_id: z.uuid(),
          video_url: z.string(),
          start_seconds: z.number().int().min(0).max(604800),
          note: z.string(),
        }),
      )
      .parse(saved ?? [])
      .map((correction) => [correction.review_id, correction]),
  );
  for (const row of rows) {
    const correction = corrections.get(row.request_id);
    (result[row.game_id] ??= []).push(
      standaloneReviewSchema.parse({
        id: row.request_id,
        audience: row.audience,
        playerId: row.player_id,
        playerName: row.player_name,
        note: correction?.note ?? row.note,
        selectedAt: new Date(row.selected_at).toISOString(),
        ...(correction && {
          videoReview: {
            url: correction.video_url,
            positionSeconds: correction.start_seconds,
            lookBackSeconds: 0,
          },
        }),
      }),
    );
  }
  return result;
}
