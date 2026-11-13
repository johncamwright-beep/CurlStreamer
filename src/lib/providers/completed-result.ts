import "server-only";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  completedResultCorrectionSchema,
  type CompletedResultCorrection,
  type CompletedResultSnapshot,
} from "@/lib/completed-result";

type FailureKind = "authorization" | "conflict" | "terminal" | "service";
type Result =
  | { ok: true; value: CompletedResultSnapshot }
  | { ok: false; kind: FailureKind };
const idSchema = z.string().uuid();
const snapshotSchema = z.object({
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  completion: z.object({
    status: z.literal("completed"),
    eventName: z.string(),
    homeName: z.string(),
    awayName: z.string(),
    completedAt: z.string(),
    youtubeWatchUrl: z.string().nullable(),
    result: z.object({
      outcome: z.enum(["no_result", "tie", "home_win", "away_win"]),
      label: z.string(),
      totals: z.object({ home: z.number(), away: z.number() }).nullable(),
      ends: z.array(z.unknown()),
    }),
  }),
});

async function execute(
  gameId: string,
  correction?: CompletedResultCorrection,
): Promise<Result> {
  try {
    const id = idSchema.parse(gameId);
    const { data, error } = await (
      await createServerSupabaseClient()
    ).auth.getUser();
    if (error || !data.user?.email_confirmed_at)
      return { ok: false, kind: "authorization" };
    const userId = idSchema.parse(data.user.id);
    const input = correction
      ? completedResultCorrectionSchema.parse(correction)
      : undefined;
    const result = await createAdminSupabaseClient().rpc(
      input ? "correct_completed_game_result" : "read_completed_game_result",
      {
        p_game_id: id,
        p_actor_user_id: userId,
        ...(input
          ? {
              p_request_id: input.requestId,
              p_expected_revision: input.expectedRevision,
              p_ends: input.ends,
              p_reason: input.reason,
            }
          : {}),
      },
    );
    if (result.error) {
      const code = result.error.code;
      return {
        ok: false,
        kind:
          code === "42501"
            ? "authorization"
            : ["PT409", "40001", "23505"].includes(code)
              ? "conflict"
              : code === "55000"
                ? "terminal"
                : "service",
      };
    }
    const snapshot = snapshotSchema.safeParse(result.data);
    return snapshot.success
      ? { ok: true, value: snapshot.data }
      : { ok: false, kind: "service" };
  } catch {
    return { ok: false, kind: "service" };
  }
}

export const readCompletedResult = (gameId: string) => execute(gameId);
export const correctCompletedResult = (
  gameId: string,
  correction: CompletedResultCorrection,
) => execute(gameId, correction);
