import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import type { BroadcastReview, ReviewRecording } from "@/lib/curlcoach/review";

const sessionSchema = z.object({
  game_id: z.uuid(),
  youtube_broadcast_id: z
    .string()
    .regex(/^[a-zA-Z0-9_-]{11}$/)
    .nullable(),
  started_at: z.string().nullable().optional(),
  stopped_at: z.string().nullable().optional(),
  is_current: z.boolean(),
});

function recordingTime(recording: ReviewRecording) {
  return Date.parse(recording.endedAt ?? recording.startedAt ?? "") || 0;
}

/** Private broadcast tables are not directly readable, even by the application
 * server. The RPC authorizes every game and exposes only recording metadata. */
export async function loadCoachBroadcastReviews(
  organizationId: string,
  gameIds: string[],
  actorUserId: string,
): Promise<Record<string, BroadcastReview>> {
  const result: Record<string, BroadcastReview> = {};
  if (!gameIds.length) return result;
  try {
    const { data, error } = await createAdminSupabaseClient().rpc(
      "read_shot_tracker_recording_history",
      { p_actor: actorUserId, p_org: organizationId, p_games: gameIds },
    );
    if (error) return result;
    const previousByGame = new Map<string, ReviewRecording[]>();
    for (const row of Array.isArray(data) ? data : []) {
      const parsed = sessionSchema.safeParse(row);
      if (!parsed.success || !parsed.data.youtube_broadcast_id) continue;
      const session = parsed.data;
      if (!gameIds.includes(session.game_id)) continue;
      const recording: ReviewRecording = {
        url: `https://www.youtube.com/watch?v=${session.youtube_broadcast_id}`,
        ...(session.started_at
          ? { startedAt: session.started_at, estimated: true }
          : {}),
        ...(session.stopped_at ? { endedAt: session.stopped_at } : {}),
      };
      if (session.is_current) {
        result[session.game_id] = recording;
      } else {
        const previous = previousByGame.get(session.game_id) ?? [];
        previous.push(recording);
        previousByGame.set(session.game_id, previous);
      }
    }
    for (const [gameId, previous] of previousByGame) {
      previous.sort((a, b) => recordingTime(b) - recordingTime(a));
      const recording = result[gameId] ?? previous.shift()!;
      result[gameId] = {
        ...recording,
        ...(previous.length ? { previous } : {}),
      };
    }
  } catch {
    // A recording lookup failure must not interrupt charting or leak private errors.
  }
  return result;
}
