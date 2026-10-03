import "server-only";
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

const credentialsSchema = z.array(
  z.object({
    organization_id: z.uuid(),
    encrypted_credentials: z.string().min(1),
    channel_id: z.string().min(1),
    connection_version: z.coerce.number().int().nonnegative(),
  }),
);

export async function getScheduledYouTubeCredentials(
  user: User,
  gameId: string,
) {
  const { data, error } = await createAdminSupabaseClient().rpc(
    "get_scheduled_youtube_credentials",
    { p_user_id: z.uuid().parse(user.id), p_game_id: z.uuid().parse(gameId) },
  );
  if (error) throw new Error("youtube_credentials_failed");
  const rows = credentialsSchema.parse(data);
  if (rows.length !== 1) throw new Error("youtube_reconnect_required");
  return rows[0];
}
