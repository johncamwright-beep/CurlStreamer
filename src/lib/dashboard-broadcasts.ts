import "server-only";
import type { AccountContext } from "@/lib/auth/account";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { youtubeWatchUrlSchema } from "@/lib/youtube-watch";

export type DashboardBroadcast = {
  gameId: string;
  status: "idle" | "preparing" | "live" | "stopping" | "stopped" | "failed";
  watchUrl: string | null;
  updatedAt: string | null;
};

// AccountContext comes from the authenticated server page, never request input.
// Read only display fields, scoped to both membership and authorized game IDs.
export async function loadDashboardBroadcasts(
  account: AccountContext,
  gameIds: string[],
): Promise<{ available: boolean; sessions: DashboardBroadcast[] }> {
  if (account.profile.status !== "active" || !account.membership)
    return { available: false, sessions: [] };
  if (!gameIds.length) return { available: true, sessions: [] };
  try {
    const sessions: DashboardBroadcast[] = [];
    for (let offset = 0; offset < gameIds.length; offset += 100) {
      const ids = gameIds.slice(offset, offset + 100);
      const { data, error } = await createAdminSupabaseClient()
        .from("broadcast_sessions")
        .select("game_id,status,watch_url,updated_at")
        .eq("organization_id", account.membership.organization_id)
        .eq("provider", "youtube")
        .in("game_id", ids);
      if (error) return { available: false, sessions: [] };
      for (const row of data ?? []) {
        if (
          !ids.includes(row.game_id) ||
          ![
            "idle",
            "preparing",
            "live",
            "stopping",
            "stopped",
            "failed",
          ].includes(row.status)
        )
          continue;
        const watch = youtubeWatchUrlSchema.safeParse(row.watch_url ?? "");
        sessions.push({
          gameId: row.game_id,
          status: row.status as DashboardBroadcast["status"],
          watchUrl: watch.success ? watch.data : null,
          updatedAt:
            typeof row.updated_at === "string" &&
            Number.isFinite(Date.parse(row.updated_at))
              ? row.updated_at
              : null,
        });
      }
    }
    return { available: true, sessions };
  } catch {
    return { available: false, sessions: [] };
  }
}
