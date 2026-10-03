import "server-only";
import type { User } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { loadActiveTeam } from "@/lib/team-games";

export type CoachAccount = {
  userId: string;
  organizationId: string;
  user: User;
};

/**
 * Establishes the authenticated account scope before a server-only CurlCoach
 * RPC is called. The database repeats account, membership, entitlement, and
 * explicit coach-grant checks for every private read and write.
 */
export async function requireCoachAccount(): Promise<CoachAccount | null> {
  const { data, error } = await (
    await createServerSupabaseClient()
  ).auth.getUser();
  if (error || !data.user?.email_confirmed_at) return null;
  const team = await loadActiveTeam(data.user);
  if (team.kind !== "ready") return null;
  const { error: accessError } = await createAdminSupabaseClient().rpc(
    "assert_curlcoach_access",
    {
      p_actor_user_id: data.user.id,
      p_organization_id: team.team.organizationId,
    },
  );
  if (accessError) return null;
  return {
    userId: data.user.id,
    organizationId: team.team.organizationId,
    user: data.user,
  };
}
