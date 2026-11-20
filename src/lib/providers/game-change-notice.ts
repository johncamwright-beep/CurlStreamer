import "server-only";
import { createHmac } from "node:crypto";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

/** Opaque invalidation capability, never a game projection or access credential.
 * Every refresh still passes the ordinary game authorization boundary. */
export function gameChangeNotice(gameId: string) {
  const secret = process.env.ROLE_TOKEN_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!secret || secret.length < 32 || !url?.startsWith("https://") || !key)
    return undefined;
  return {
    url,
    key,
    topic: `game-change-${createHmac("sha256", secret).update(`game-change-v1:${gameId}`).digest("hex")}`,
  };
}

export async function publishGameChange(gameId: string) {
  const notice = gameChangeNotice(gameId);
  if (!notice) return;
  try {
    const db = createAdminSupabaseClient();
    const channel = db.channel(notice.topic);
    try {
      // REST broadcast is ephemeral. No change-log or presence rows are written.
      await channel.httpSend("changed", {}, { timeout: 1000 });
    } finally {
      await db.removeChannel(channel);
    }
  } catch {
    // A saved mutation stays successful even if its best-effort notice fails.
    // Clients retain a bounded fallback read.
  }
}
