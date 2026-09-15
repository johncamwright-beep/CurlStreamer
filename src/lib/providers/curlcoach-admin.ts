import "server-only";

import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export function curlCoachAdminEnabled(
  env: { CURLCOACH_ENABLED?: string } = process.env as {
    CURLCOACH_ENABLED?: string;
  },
) {
  return env.CURLCOACH_ENABLED === "true";
}

export type CurlCoachAccessAction = "grant" | "revoke";

type AccessChange = {
  actorUserId: string;
  targetUserId: string;
  action: CurlCoachAccessAction;
  expiresAt?: string;
};

export async function changeCurlCoachAccess(change: AccessChange) {
  if (!curlCoachAdminEnabled()) throw new Error("CurlCoach is unavailable");
  const db = createAdminSupabaseClient();
  const { error } = await db.rpc(
    change.action === "grant"
      ? "grant_curlcoach_access"
      : "revoke_curlcoach_access",
    change.action === "grant"
      ? {
          p_actor_user_id: change.actorUserId,
          p_target_user_id: change.targetUserId,
          p_expires_at: change.expiresAt ?? null,
        }
      : {
          p_actor_user_id: change.actorUserId,
          p_target_user_id: change.targetUserId,
        },
  );
  if (error) throw error;
}

export async function setCurlCoachEntitlement({
  actorUserId,
  organizationId,
  expiresAt,
}: {
  actorUserId: string;
  organizationId: string;
  expiresAt?: string;
}) {
  if (!curlCoachAdminEnabled()) throw new Error("CurlCoach is unavailable");
  const { error } = await createAdminSupabaseClient().rpc(
    "set_curlcoach_entitlement",
    {
      p_actor_user_id: actorUserId,
      p_organization_id: organizationId,
      p_expires_at: expiresAt ?? null,
    },
  );
  if (error) throw error;
}
