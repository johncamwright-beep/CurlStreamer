import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { CoachAccount } from "@/lib/curlcoach/production-access";
import type { ReviewCorrection } from "@/lib/curlcoach/flagged-shots";

const rowSchema = z.object({
  game_id: z.uuid(),
  shot_id: z.uuid(),
  video_url: z.string(),
  start_seconds: z.number().int().min(0).max(604800),
  note: z.string(),
});
export async function loadReviewCorrections(
  account: CoachAccount,
  gameIds: string[],
) {
  const result: Record<string, ReviewCorrection[]> = {};
  if (!gameIds.length) return result;
  const { data, error } = await createAdminSupabaseClient()
    .from("shot_tracker_review_corrections")
    .select("game_id,shot_id,video_url,start_seconds,note")
    .eq("organization_id", account.organizationId)
    .eq("actor_user_id", account.userId)
    .in("game_id", gameIds)
    .order("sequence", { ascending: false });
  // Permit staged deployment before the additive migration is applied.
  if (error?.code === "42P01" || error?.code === "PGRST205") return result;
  if (error) throw new Error("Shot review corrections unavailable");
  const seen = new Set<string>();
  for (const row of z.array(rowSchema).parse(data)) {
    const key = row.game_id + ":" + row.shot_id;
    if (seen.has(key)) continue;
    seen.add(key);
    (result[row.game_id] ??= []).push({
      shotId: row.shot_id,
      note: row.note,
      video: {
        url: row.video_url,
        positionSeconds: row.start_seconds,
        lookBackSeconds: 0,
        delaySeconds: 0,
      },
    });
  }
  return result;
}
