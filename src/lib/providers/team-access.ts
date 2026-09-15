import "server-only";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
export async function requireTeamBroadcastAccess(
  organizationId: string | undefined,
) {
  if (!organizationId)
    throw Object.assign(Error("Team access unavailable"), { code: "P0402" });
  const { error } = await createAdminSupabaseClient().rpc(
    "assert_team_broadcast_access",
    { p_org: organizationId },
  );
  if (error)
    throw Object.assign(Error("Team access unavailable"), { code: error.code });
}
