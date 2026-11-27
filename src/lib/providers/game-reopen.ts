import "server-only";
import { z } from "zod";
import { reopenGameSchema } from "@/lib/game-reopen";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function reopenGame(
  gameId: string,
  input: z.infer<typeof reopenGameSchema>,
) {
  try {
    const id = z.uuid().parse(gameId);
    const body = reopenGameSchema.parse(input);
    const { data, error } = await (
      await createServerSupabaseClient()
    ).auth.getUser();
    if (error || !data.user?.email_confirmed_at)
      return { ok: false, code: "42501" } as const;
    const result = await createAdminSupabaseClient().rpc(
      "reopen_completed_game",
      {
        p_game_id: id,
        p_actor_user_id: z.uuid().parse(data.user.id),
        p_request_id: body.requestId,
        p_expected_revision: body.expectedRevision,
      },
    );
    if (result.error) return { ok: false, code: result.error.code } as const;
    if (result.data?.status !== "active" || result.data?.gameId !== id)
      return { ok: false, code: "service" } as const;
    return { ok: true } as const;
  } catch {
    return { ok: false, code: "service" } as const;
  }
}
